"""The focus queue is a chosen shortlist, independent of Plan structure."""
import os
from pathlib import Path
import sqlite3
import subprocess

import pytest
from fastapi.testclient import TestClient

from test_ritual_flow import app, clean_test_database, create_goal_and_task, engine
from app.models import FocusQueueModel, GoalModel
from sqlalchemy import select
from sqlalchemy.orm import Session

pytestmark = pytest.mark.usefixtures("clean_test_database")


def queue_ids(response):
    assert response.status_code == 200, response.text
    return [item["task"]["id"] for item in response.json()]


def test_queue_starts_empty_and_keeps_custom_order_across_requests():
    client = TestClient(app)
    goal, first = create_goal_and_task(client)
    second = client.post(f"/goals/{goal['id']}/tasks", json={"title": "Second"}).json()
    other_goal, third = create_goal_and_task(client, "A different project", "Third")

    assert queue_ids(client.get("/queue")) == []
    response = client.put("/queue", json={"ordered_ids": [third["id"], first["id"]]})
    assert queue_ids(response) == [third["id"], first["id"]]
    assert response.json()[0] == {"task": third, "goal": other_goal}
    with TestClient(app) as later_client:
        assert queue_ids(later_client.get("/queue")) == [third["id"], first["id"]]
    assert [item["task"]["id"] for item in client.get("/dashboard").json()["queue"]] == [third["id"], first["id"]]
    # The Plan and its ordering remain independent of the shortlist.
    assert [task["id"] for task in client.get(f"/goals/{goal['id']}/tasks").json()] == [first["id"], second["id"]]


def test_append_remove_and_clear_are_idempotent_without_deleting_tasks():
    client = TestClient(app)
    goal, first = create_goal_and_task(client)
    second = client.post("/standalone-tasks", json={"title": "Pay bill"}).json()

    assert queue_ids(client.post(f"/queue/{first['id']}")) == [first["id"]]
    assert queue_ids(client.post(f"/queue/{second['id']}")) == [first["id"], second["id"]]
    assert queue_ids(client.post(f"/queue/{first['id']}")) == [first["id"], second["id"]]
    assert queue_ids(client.delete(f"/queue/{first['id']}")) == [second["id"]]
    assert queue_ids(client.delete(f"/queue/{first['id']}")) == [second["id"]]
    assert queue_ids(client.put("/queue", json={"ordered_ids": []})) == []
    assert client.get(f"/goals/{goal['id']}/tasks").json()[0]["completed"] is False


@pytest.mark.parametrize("invalid_kind,expected_status", [
    ("duplicate", 422), ("missing", 404), ("parent", 409), ("completed", 409),
    ("closed", 409), ("invalid_id", 422),
])
def test_invalid_replacement_preserves_entire_existing_queue(invalid_kind, expected_status):
    client = TestClient(app)
    _, first = create_goal_and_task(client)
    other_goal, invalid = create_goal_and_task(client, "Other", "Other task")
    client.post(f"/queue/{first['id']}")
    requested_ids = [first["id"], invalid["id"]]
    if invalid_kind == "duplicate":
        requested_ids = [first["id"], first["id"]]
    elif invalid_kind == "missing":
        requested_ids.append(999999)
    elif invalid_kind == "parent":
        client.post(f"/tasks/{invalid['id']}/subtasks", json={"title": "Child"})
    elif invalid_kind == "completed":
        client.patch(f"/tasks/{invalid['id']}", json={"completed": True})
    elif invalid_kind == "closed":
        # Guard against historical data with an unfinished task in a closed goal.
        with Session(engine) as db:
            db.get(GoalModel, other_goal["id"]).completed = True
            db.commit()
    else:
        requested_ids = [True]

    assert client.put("/queue", json={"ordered_ids": requested_ids}).status_code == expected_status
    assert queue_ids(client.get("/queue")) == [first["id"]]
    if invalid_kind in {"parent", "completed", "closed"}:
        assert client.post(f"/queue/{invalid['id']}").status_code == 409
        assert queue_ids(client.get("/queue")) == [first["id"]]


def test_completion_hides_membership_and_reopening_restores_original_order():
    client = TestClient(app)
    goal, first = create_goal_and_task(client)
    second = client.post(f"/goals/{goal['id']}/tasks", json={"title": "Second"}).json()
    client.put("/queue", json={"ordered_ids": [second["id"], first["id"]]})

    client.patch(f"/tasks/{second['id']}", json={"completed": True})
    assert queue_ids(client.get("/queue")) == [first["id"]]
    assert [item["task"]["id"] for item in client.get("/dashboard").json()["queue"]] == [first["id"]]
    client.patch(f"/tasks/{second['id']}", json={"completed": False})
    assert queue_ids(client.get("/queue")) == [second["id"], first["id"]]


def test_adding_child_or_closing_direction_hides_queued_work():
    client = TestClient(app)
    goal, task = create_goal_and_task(client)
    client.post(f"/queue/{task['id']}")
    child = client.post(f"/tasks/{task['id']}/subtasks", json={"title": "Child"}).json()
    assert queue_ids(client.get("/queue")) == []
    client.delete(f"/tasks/{child['id']}")
    assert queue_ids(client.get("/queue")) == [task["id"]]
    with Session(engine) as db:
        db.get(GoalModel, goal["id"]).completed = True
        db.commit()
    assert queue_ids(client.get("/queue")) == []
    assert client.get("/dashboard").json()["queue"] == []


@pytest.mark.parametrize("delete_goal", [False, True])
def test_deleting_task_or_direction_cascades_queue_membership(delete_goal):
    client = TestClient(app)
    goal, task = create_goal_and_task(client)
    client.post(f"/queue/{task['id']}")

    response = client.delete(f"/goals/{goal['id']}" if delete_goal else f"/tasks/{task['id']}")
    assert response.status_code == 200
    assert queue_ids(client.get("/queue")) == []
    with Session(engine) as db:
        assert db.scalars(select(FocusQueueModel)).all() == []


def test_focus_queue_migration_preserves_plan_and_enforces_task_cascade(tmp_path):
    root = Path(__file__).resolve().parents[1]
    database = tmp_path / "queue-migration.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database}", "PYTHONDONTWRITEBYTECODE": "1", "OPENAI_API_KEY": ""}

    def migrate(*args):
        subprocess.run([str(root / ".venv/bin/alembic"), *args], cwd=root, env=env, check=True, capture_output=True)

    migrate("upgrade", "20260919_09")
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO goals (id,title,goal_type,completed,position) VALUES (1,'Existing','project',0,1)")
        db.execute("INSERT INTO tasks (id,goal_id,depth,title,completed,position) VALUES (1,1,1,'Existing task',0,1)")
    migrate("upgrade", "head")
    with sqlite3.connect(database) as db:
        db.execute("PRAGMA foreign_keys=ON")
        assert db.execute("SELECT title FROM tasks").fetchone() == ("Existing task",)
        assert db.execute("SELECT * FROM focus_queue").fetchall() == []
        db.execute("INSERT INTO focus_queue (task_id,position) VALUES (1,1)")
        db.execute("DELETE FROM tasks WHERE id=1")
        assert db.execute("SELECT * FROM focus_queue").fetchall() == []
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    migrate("downgrade", "20260919_09")
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT title FROM goals").fetchone() == ("Existing",)
