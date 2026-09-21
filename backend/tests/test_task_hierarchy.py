"""Two task levels and explicit downward-only completion across app flows."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from test_ritual_flow import app, clean_test_database, create_goal_and_task, engine
from app.models import GoalModel, TaskModel

pytestmark = pytest.mark.usefixtures("clean_test_database")


def make_hierarchy(client):
    goal, parent = create_goal_and_task(client)
    first = client.post(f"/tasks/{parent['id']}/subtasks", json={"title": "Read references"}).json()
    second = client.post(f"/tasks/{parent['id']}/subtasks", json={"title": "Write the summary"}).json()
    sibling = client.post(f"/goals/{goal['id']}/tasks", json={"title": "Separate work"}).json()
    return goal, parent, first, second, sibling


def completion_by_id(client, goal):
    return {task["id"]: task["completed"] for task in client.get(f"/goals/{goal['id']}/tasks").json()}


@pytest.mark.parametrize("goal_type", ["project", "learning"])
def test_subtasks_are_last_level_and_cannot_be_broken_down(goal_type):
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Direction", "goal_type": goal_type}).json()
    parent = client.post(f"/goals/{goal['id']}/tasks", json={"title": "Task"}).json()
    child = client.post(f"/tasks/{parent['id']}/subtasks", json={"title": "Subtask"}).json()
    assert child["depth"] == 2
    assert client.post(f"/tasks/{child['id']}/subtasks", json={"title": "Too deep"}).status_code == 400
    assert client.post(f"/tasks/{child['id']}/breakdown").status_code == 404
    assert len(client.get(f"/goals/{goal['id']}/tasks").json()) == 2


def test_completing_parent_completes_descendants_only_and_reopen_is_explicit():
    client = TestClient(app)
    goal, parent, first, second, sibling = make_hierarchy(client)
    assert client.patch(f"/tasks/{parent['id']}", json={"completed": True}).status_code == 200
    assert completion_by_id(client, goal) == {parent["id"]: True, first["id"]: True, second["id"]: True, sibling["id"]: False}
    assert client.get(f"/goals/{goal['id']}").json()["completed"] is False
    client.patch(f"/tasks/{parent['id']}", json={"completed": False})
    assert completion_by_id(client, goal) == {parent["id"]: False, first["id"]: True, second["id"]: True, sibling["id"]: False}


def test_completing_all_children_never_automatically_completes_parent():
    client = TestClient(app)
    goal, parent, first, second, sibling = make_hierarchy(client)
    for child in (first, second):
        client.patch(f"/tasks/{child['id']}", json={"completed": True})
    assert completion_by_id(client, goal) == {parent["id"]: False, first["id"]: True, second["id"]: True, sibling["id"]: False}
    options = client.get("/focus-options").json()
    assert [option["id"] for option in options] == [parent["id"], sibling["id"]]
    assert options[0]["has_children"] is True


@pytest.mark.parametrize("parent_first", [True, False])
def test_ritual_cascade_does_not_depend_on_selection_order(parent_first):
    client = TestClient(app)
    goal, parent, first, second, sibling = make_hierarchy(client)
    selected = [{"task_id": parent["id"], "completed": True}, {"task_id": first["id"], "completed": False}]
    response = client.post("/sessions", json={
        "planned_minutes": 25, "actual_minutes": 25, "completed": True,
        "tasks": selected if parent_first else list(reversed(selected)),
    })
    assert response.status_code == 200
    assert completion_by_id(client, goal) == {parent["id"]: True, first["id"]: True, second["id"]: True, sibling["id"]: False}
    # History describes the explicit attribution choices; cascade also applies
    # to descendants that were not individually selected for this ritual.
    assert len(response.json()["attributions"]) == 2


def test_ritual_completing_only_children_leaves_parent_unfinished():
    client = TestClient(app)
    goal, parent, first, second, sibling = make_hierarchy(client)
    response = client.post("/sessions", json={
        "planned_minutes": 25, "actual_minutes": 25, "completed": True,
        "tasks": [{"task_id": child["id"], "completed": True} for child in (first, second)],
    })
    assert response.status_code == 200
    assert completion_by_id(client, goal) == {parent["id"]: False, first["id"]: True, second["id"]: True, sibling["id"]: False}


def test_focus_options_include_hierarchy_and_standalone_tasks_in_plan_order():
    client = TestClient(app)
    goal, parent, first, second, sibling = make_hierarchy(client)
    standalone = client.post("/standalone-tasks", json={"title": "Pay a bill"}).json()
    client.post("/sessions", json={"planned_minutes": 25, "actual_minutes": 25, "completed": True, "tasks": [{"task_id": sibling["id"]}]})
    client.post("/tasks/reorder", json={"ordered_ids": [second["id"], first["id"]]})
    options = client.get("/focus-options").json()
    assert [option["id"] for option in options] == [parent["id"], second["id"], first["id"], sibling["id"], standalone["id"]]
    assert options[0] == {
        "id": parent["id"], "title": parent["title"], "goal_id": goal["id"], "goal_title": goal["title"],
        "goal_type": "project", "parent_id": None, "depth": 1, "position": 1,
        "ancestor_titles": [], "has_children": True, "last_focused_at": None,
    }
    assert options[1]["ancestor_titles"] == [parent["title"]]
    assert options[1]["parent_id"] == parent["id"]
    assert options[1]["depth"] == 2
    assert options[1]["has_children"] is False
    assert options[-1]["goal_type"] == "standalone"
    with Session(engine) as db:
        db.get(GoalModel, goal["id"]).completed = True
        db.commit()
    assert [option["id"] for option in client.get("/focus-options").json()] == [standalone["id"]]
    assert client.get("/next-focus").json()["task"]["id"] == standalone["id"]


def test_legacy_deep_descendants_still_complete_before_migration():
    client = TestClient(app)
    goal, parent, first, second, sibling = make_hierarchy(client)
    with Session(engine) as db:
        deeper = TaskModel(goal_id=goal["id"], parent_id=first["id"], depth=3, title="Legacy child", position=1)
        db.add(deeper)
        db.commit()
        deeper_id = deeper.id
    client.patch(f"/tasks/{parent['id']}", json={"completed": True})
    assert completion_by_id(client, goal)[deeper_id] is True
    client.patch(f"/tasks/{deeper_id}", json={"completed": False})
    assert completion_by_id(client, goal)[first["id"]] is False
    assert completion_by_id(client, goal)[parent["id"]] is False
