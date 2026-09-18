"""End-to-end proof of Flowlist's roadmap → Pomodoro → attribution loop."""

import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# This must be set before importing Flowlist's database module. It ensures the
# test never reads from or writes to the developer's real database.
TEST_DATABASE = Path(tempfile.gettempdir()) / "flowlist-ritual-test.sqlite3"
TEST_DATABASE.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE}"
os.environ.pop("OPENAI_API_KEY", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import Base, engine  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_test_database():
    """Give every test a fresh, disposable database."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def create_goal_and_task(client: TestClient, goal_title="Write thesis", task_title="Outline chapter"):
    goal = client.post("/goals", json={"title": goal_title}).json()
    task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": task_title},
    ).json()
    return goal, task


def test_pomodoro_attribution_updates_task_and_stats():
    client = TestClient(app)
    goal, task = create_goal_and_task(client)

    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 25,
            "completed": True,
            "tasks": [{"task_id": task["id"], "completed": True}],
        },
    )

    assert session.status_code == 200
    assert session.json()["task_title"] == "Outline chapter"
    assert session.json()["attributions"] == [
        {
            "task_id": task["id"],
            "task_title": "Outline chapter",
            "goal_title": "Write thesis",
            "completed": True,
        }
    ]
    listed_task = client.get(f"/goals/{goal['id']}/tasks").json()[0]
    assert listed_task["completed"] is True
    assert client.get("/stats").json() == {
        "current_streak": 1,
        "total_sessions": 1,
        "total_minutes": 25,
    }


def test_rejects_blank_titles_and_invalid_session_durations():
    client = TestClient(app)

    assert client.post("/goals", json={"title": "   "}).status_code == 422
    goal = client.post("/goals", json={"title": "Study FastAPI"}).json()
    blank_task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": "   "},
    )
    assert blank_task.status_code == 422
    invalid_session = client.post(
        "/sessions",
        json={
            "planned_minutes": 0,
            "actual_minutes": 481,
            "completed": False,
        },
    )
    assert invalid_session.status_code == 422


def test_next_focus_follows_roadmap_order():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Build Flowlist"}).json()
    first_task = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Polish copy"}
    ).json()
    second_task = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Fix the ritual"}
    ).json()

    assert client.get("/next-focus").json()["task"]["id"] == first_task["id"]
    client.patch(f"/tasks/{first_task['id']}", json={"completed": True})
    assert client.get("/next-focus").json()["task"]["id"] == second_task["id"]


def test_standalone_tasks_share_a_simple_task_list():
    client = TestClient(app)

    first = client.post("/standalone-tasks", json={"title": "Pay electricity bill"})
    second = client.post("/standalone-tasks", json={"title": "Read The Dispossessed"})

    assert first.status_code == 200
    assert second.status_code == 200
    standalone_goals = [
        goal for goal in client.get("/goals").json()
        if goal["goal_type"] == "standalone"
    ]
    assert len(standalone_goals) == 1
    assert standalone_goals[0]["title"] == "Tasks"
    tasks = client.get(f"/goals/{standalone_goals[0]['id']}/tasks").json()
    assert [task["title"] for task in tasks] == [
        "Pay electricity bill",
        "Read The Dispossessed",
    ]


def test_can_edit_goal_and_task_titles():
    client = TestClient(app)
    goal, task = create_goal_and_task(
        client, goal_title="Learn APIs", task_title="Read docs"
    )

    updated_goal = client.patch(
        f"/goals/{goal['id']}",
        json={"title": "Learn FastAPI", "description": "Build carefully"},
    )
    updated_task = client.patch(
        f"/tasks/{task['id']}", json={"title": "Read the routing docs"}
    )

    assert updated_goal.json()["title"] == "Learn FastAPI"
    assert updated_task.json()["title"] == "Read the routing docs"
    assert client.patch(f"/tasks/{task['id']}", json={"title": "   "}).status_code == 422


def test_ended_early_session_can_be_saved_without_a_task():
    client = TestClient(app)
    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 8,
            "completed": False,
        },
    )

    assert session.status_code == 200
    assert session.json()["task_title"] == "General focus"
    assert session.json()["attributions"] == []
    assert session.json()["actual_minutes"] == 8


def test_short_ritual_summary_becomes_a_clean_history_title():
    client = TestClient(app)

    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 17,
            "completed": True,
            "summary": "  mapped the API error states.  ",
        },
    )

    assert session.status_code == 200
    assert session.json()["task_title"] == "Mapped the API error states"
    assert session.json()["summary"] == "mapped the API error states."


def test_gibberish_ritual_summary_falls_back_to_general_focus():
    client = TestClient(app)

    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 9,
            "completed": True,
            "summary": "fdsfdsa",
        },
    )

    assert session.status_code == 200
    assert session.json()["task_title"] == "General focus"
    assert session.json()["summary"] is None


def test_multiple_tasks_use_generated_shared_history_title(monkeypatch):
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "AI engineering"}).json()
    first = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Build retrieval"}
    ).json()
    second = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Evaluate responses"}
    ).json()
    monkeypatch.setattr(
        "main.suggest_focus_title",
        lambda summary, contexts: "Reliable retrieval workflow",
    )

    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 25,
            "completed": True,
            "tasks": [{"task_id": first["id"]}, {"task_id": second["id"]}],
        },
    )

    assert session.status_code == 200
    assert session.json()["task_title"] == "Reliable retrieval workflow"


def test_task_creation_has_no_prescribed_duration():
    client = TestClient(app)
    _, task = create_goal_and_task(client)

    assert "estimated_minutes" not in task


def test_learning_goal_preserves_its_type():
    client = TestClient(app)
    created = client.post(
        "/goals", json={"title": "AI engineering", "goal_type": "learning"}
    )

    assert created.status_code == 200
    assert created.json()["goal_type"] == "learning"
    assert client.get("/goals").json()[0]["goal_type"] == "learning"


def test_next_focus_is_empty_when_no_unfinished_leaf_exists():
    client = TestClient(app)

    response = client.get("/next-focus")
    assert response.status_code == 404
    assert response.json()["detail"] == "No unfinished focus task found"


def test_learning_breakdown_asks_questions_then_returns_learning_path(monkeypatch):
    client = TestClient(app)
    goal = client.post(
        "/goals", json={"title": "AI engineering", "goal_type": "learning"}
    ).json()
    monkeypatch.setattr(
        "main.suggest_learning_questions",
        lambda title, description: [
            {"id": "level", "question": "What is your current level?"}
        ],
    )

    questions = client.post(f"/goals/{goal['id']}/breakdown/questions")
    assert questions.status_code == 200
    monkeypatch.setattr(
        "main.suggest_learning_tasks",
        lambda title, description, answers: [{"title": "Build a small model"}],
    )
    response = client.post(
        f"/goals/{goal['id']}/breakdown",
        json={"answers": [{"id": "level", "answer": "Comfortable with Python"}]},
    )

    assert response.status_code == 200
    assert response.json() == [{"title": "Build a small model"}]


def test_project_cannot_use_learning_breakdown():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Launch a portfolio"}).json()

    response = client.post(f"/goals/{goal['id']}/breakdown/questions")
    assert response.status_code == 400


def test_focus_options_prefer_recent_unfinished_work():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Build Flowlist"}).json()
    first = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "First in roadmap"}
    ).json()
    recent = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Recently focused"}
    ).json()
    client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 25,
            "completed": True,
            "tasks": [{"task_id": recent["id"]}],
        },
    )

    options = client.get("/focus-options").json()
    assert [option["id"] for option in options] == [recent["id"], first["id"]]
    assert options[0]["last_focused_at"] is not None


def test_focus_options_break_same_second_ties_by_latest_session():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Build Flowlist"}).json()
    first = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Focused first"}
    ).json()
    latest = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Focused latest"}
    ).json()
    for task in (first, latest):
        response = client.post(
            "/sessions",
            json={
                "planned_minutes": 25,
                "actual_minutes": 25,
                "completed": True,
                "tasks": [{"task_id": task["id"]}],
            },
        )
        assert response.status_code == 200

    options = client.get("/focus-options").json()

    assert [option["id"] for option in options] == [latest["id"], first["id"]]


def test_session_history_survives_task_deletion():
    client = TestClient(app)
    _, task = create_goal_and_task(client)
    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 12,
            "completed": False,
            "tasks": [{"task_id": task["id"]}],
        },
    ).json()

    client.delete(f"/tasks/{task['id']}")
    listed = client.get("/sessions").json()
    assert listed[0]["id"] == session["id"]
    assert listed[0]["task_title"] == "Outline chapter"
    assert listed[0]["attributions"][0]["task_id"] is None
    assert listed[0]["attributions"][0]["task_title"] == "Outline chapter"


def test_one_session_can_cover_multiple_tasks_and_finish_selected_ones():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Ship release"}).json()
    first = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Write notes"}
    ).json()
    second = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Publish build"}
    ).json()

    response = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 25,
            "completed": True,
            "tasks": [
                {"task_id": first["id"], "completed": False},
                {"task_id": second["id"], "completed": True},
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["task_title"] == "Ship release focus"
    assert [item["task_id"] for item in response.json()["attributions"]] == [
        first["id"],
        second["id"],
    ]
    tasks = client.get(f"/goals/{goal['id']}/tasks").json()
    assert [task["completed"] for task in tasks] == [False, True]
    assert client.get("/stats").json()["total_sessions"] == 1


def test_history_record_can_be_deleted_without_changing_tasks():
    client = TestClient(app)
    goal, task = create_goal_and_task(client)
    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 10,
            "completed": False,
            "tasks": [{"task_id": task["id"]}],
        },
    ).json()

    response = client.delete(f"/sessions/{session['id']}")

    assert response.status_code == 200
    assert client.get("/sessions").json() == []
    assert client.get(f"/goals/{goal['id']}/tasks").json()[0]["completed"] is False
    assert client.delete(f"/sessions/{session['id']}").status_code == 404


def test_missing_task_rejects_entire_multi_task_session_atomically():
    client = TestClient(app)
    goal, task = create_goal_and_task(client)

    response = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 25,
            "completed": True,
            "tasks": [
                {"task_id": task["id"], "completed": True},
                {"task_id": 999_999, "completed": False},
            ],
        },
    )

    assert response.status_code == 404
    assert client.get("/sessions").json() == []
    assert client.get(f"/goals/{goal['id']}/tasks").json()[0]["completed"] is False


def test_duplicate_task_attribution_is_rejected_by_the_request_schema():
    client = TestClient(app)
    _, task = create_goal_and_task(client)

    response = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 25,
            "completed": True,
            "tasks": [
                {"task_id": task["id"]},
                {"task_id": task["id"], "completed": True},
            ],
        },
    )

    assert response.status_code == 422
    assert client.get("/sessions").json() == []


def test_goal_deletion_preserves_attribution_snapshot():
    client = TestClient(app)
    goal, task = create_goal_and_task(client)
    session = client.post(
        "/sessions",
        json={
            "planned_minutes": 25,
            "actual_minutes": 18,
            "completed": False,
            "tasks": [{"task_id": task["id"]}],
        },
    ).json()

    assert client.delete(f"/goals/{goal['id']}").status_code == 200

    history = client.get("/sessions").json()
    assert history[0]["id"] == session["id"]
    assert history[0]["task_title"] == "Outline chapter"
    assert history[0]["attributions"][0] == {
        "task_id": None,
        "task_title": "Outline chapter",
        "goal_title": "Write thesis",
        "completed": False,
    }


def test_nested_completion_rolls_up_only_after_explicit_section_approval():
    client = TestClient(app)
    goal = client.post(
        "/goals", json={"title": "Learn retrieval", "goal_type": "learning"}
    ).json()
    section = client.post(
        f"/goals/{goal['id']}/tasks", json={"title": "Vector search"}
    ).json()
    first = client.post(
        f"/tasks/{section['id']}/subtasks", json={"title": "Read the guide"}
    ).json()
    second = client.post(
        f"/tasks/{section['id']}/subtasks", json={"title": "Build a demo"}
    ).json()

    assert client.patch(
        f"/tasks/{section['id']}", json={"completed": True}
    ).status_code == 409
    client.patch(f"/tasks/{first['id']}", json={"completed": True})
    client.patch(f"/tasks/{second['id']}", json={"completed": True})
    assert client.patch(
        f"/tasks/{section['id']}", json={"completed": True}
    ).status_code == 200
    assert client.patch(
        f"/goals/{goal['id']}", json={"completed": True}
    ).status_code == 200

    client.patch(f"/tasks/{first['id']}", json={"completed": False})
    tasks = {task["id"]: task for task in client.get(f"/goals/{goal['id']}/tasks").json()}
    reopened_goal = client.get(f"/goals/{goal['id']}").json()
    assert tasks[first["id"]]["completed"] is False
    assert tasks[second["id"]]["completed"] is True
    assert tasks[section["id"]]["completed"] is False
    assert reopened_goal["completed"] is False


def test_plan_order_is_persistent_for_goals_and_sibling_tasks():
    client = TestClient(app)
    first_goal = client.post("/goals", json={"title": "First"}).json()
    second_goal = client.post("/goals", json={"title": "Second"}).json()
    first_task = client.post(
        f"/goals/{first_goal['id']}/tasks", json={"title": "A"}
    ).json()
    second_task = client.post(
        f"/goals/{first_goal['id']}/tasks", json={"title": "B"}
    ).json()

    reordered_goals = client.post(
        "/goals/reorder",
        json={"ordered_ids": [second_goal["id"], first_goal["id"]]},
    )
    reordered_tasks = client.post(
        "/tasks/reorder",
        json={"ordered_ids": [second_task["id"], first_task["id"]]},
    )

    assert reordered_goals.status_code == 200
    assert [goal["title"] for goal in client.get("/goals").json()] == ["Second", "First"]
    assert reordered_tasks.status_code == 200
    assert [
        task["title"] for task in client.get(f"/goals/{first_goal['id']}/tasks").json()
    ] == ["B", "A"]
