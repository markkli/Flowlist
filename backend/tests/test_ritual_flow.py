"""End-to-end proof of Flowlist's core goal → focus → progress loop."""

import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# This must be set before importing Flowlist's database module. It ensures the
# test never reads from or writes to the developer's PostgreSQL database.
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


def test_focus_ritual_updates_stats():
    client = TestClient(app)

    goal = client.post("/goals", json={"title": "Write thesis"})
    assert goal.status_code == 200

    task = client.post(
        f"/goals/{goal.json()['id']}/tasks",
        json={"title": "Outline chapter", "estimated_minutes": 25},
    )
    assert task.status_code == 200

    completed_task = client.patch(
        f"/tasks/{task.json()['id']}", json={"completed": True}
    )
    assert completed_task.json()["completed"] is True

    session = client.post(
        f"/tasks/{task.json()['id']}/sessions",
        json={"actual_minutes": 25, "completed": True},
    )
    assert session.status_code == 200

    stats = client.get("/stats")
    assert stats.status_code == 200
    assert stats.json() == {
        "current_streak": 1,
        "total_sessions": 1,
        "total_minutes": 25,
    }


def test_rejects_blank_titles_and_invalid_durations():
    client = TestClient(app)

    blank_goal = client.post("/goals", json={"title": "   "})
    assert blank_goal.status_code == 422

    goal = client.post("/goals", json={"title": "Study FastAPI"})
    too_short_task = client.post(
        f"/goals/{goal.json()['id']}/tasks",
        json={"title": "Read routing", "estimated_minutes": 4},
    )
    assert too_short_task.status_code == 422

    task = client.post(
        f"/goals/{goal.json()['id']}/tasks",
        json={"title": "Read routing", "estimated_minutes": 25},
    )
    too_long_session = client.post(
        f"/tasks/{task.json()['id']}/sessions",
        json={"actual_minutes": 481, "completed": True},
    )
    assert too_long_session.status_code == 422


def test_next_focus_prefers_priority_then_age():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Build Flowlist"}).json()

    later_task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": "Polish copy", "priority": 3},
    ).json()
    urgent_task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": "Fix the ritual", "priority": 1},
    ).json()

    next_focus = client.get("/next-focus")
    assert next_focus.status_code == 200
    assert next_focus.json()["task"]["id"] == urgent_task["id"]
    assert next_focus.json()["goal"]["title"] == "Build Flowlist"

    client.patch(f"/tasks/{urgent_task['id']}", json={"completed": True})
    assert client.get("/next-focus").json()["task"]["id"] == later_task["id"]


def test_can_edit_goal_and_task_fields():
    client = TestClient(app)
    goal = client.post(
        "/goals", json={"title": "Learn APIs", "description": "First draft"}
    ).json()
    task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": "Read docs", "estimated_minutes": 25},
    ).json()

    updated_goal = client.patch(
        f"/goals/{goal['id']}",
        json={"title": "Learn FastAPI", "description": "Build carefully"},
    )
    updated_task = client.patch(
        f"/tasks/{task['id']}",
        json={"title": "Read the routing docs", "estimated_minutes": 40, "priority": 1},
    )

    assert updated_goal.status_code == 200
    assert updated_goal.json()["title"] == "Learn FastAPI"
    assert updated_goal.json()["description"] == "Build carefully"
    assert updated_task.status_code == 200
    assert updated_task.json()["title"] == "Read the routing docs"
    assert updated_task.json()["estimated_minutes"] == 40
    assert updated_task.json()["priority"] == 1

    invalid_update = client.patch(f"/tasks/{task['id']}", json={"title": "   "})
    assert invalid_update.status_code == 422


def test_ended_early_session_records_elapsed_minutes():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Practice focus"}).json()
    task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": "Begin a quiet block", "estimated_minutes": 25},
    ).json()

    session = client.post(
        f"/tasks/{task['id']}/sessions",
        json={"actual_minutes": 0, "completed": False},
    )

    assert session.status_code == 200
    assert session.json()["actual_minutes"] == 0
    assert session.json()["completed"] is False


def test_task_creation_accepts_priority():
    client = TestClient(app)
    goal = client.post("/goals", json={"title": "Prioritize work"}).json()
    task = client.post(
        f"/goals/{goal['id']}/tasks",
        json={"title": "Start with the important thing", "priority": 1},
    )

    assert task.status_code == 200
    assert task.json()["priority"] == 1


def test_next_focus_is_empty_when_no_unfinished_leaf_exists():
    client = TestClient(app)
    response = client.get("/next-focus")

    assert response.status_code == 404
    assert response.json()["detail"] == "No unfinished focus task found"
