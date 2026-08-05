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
