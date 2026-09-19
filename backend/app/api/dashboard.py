from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app import schemas
from app.database import get_db
from app.models import FocusSessionModel, GoalModel
from app.api.queue import queue_items

router = APIRouter()


def activity_data(db: Session, timezone_name: str):
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Unknown timezone")
    days = {}
    total_minutes = 0
    count = 0
    for created, minutes in db.execute(select(FocusSessionModel.created_at, FocusSessionModel.actual_minutes).where(FocusSessionModel.deleted_at.is_(None))):
        local_day = created.replace(tzinfo=timezone.utc).astimezone(zone).date()
        row = days.setdefault(local_day, {"sessions": 0, "minutes": 0})
        row["sessions"] += 1
        row["minutes"] += minutes
        total_minutes += minutes
        count += 1
    today = datetime.now(zone).date()
    cursor = today if days.get(today, {}).get("minutes", 0) > 0 else today - timedelta(days=1)
    streak = 0
    while days.get(cursor, {}).get("minutes", 0) > 0:
        streak += 1
        cursor -= timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())
    start = week_start - timedelta(weeks=15)
    return {
        "stats": {"current_streak": streak, "total_sessions": count, "total_minutes": total_minutes},
        "week_sessions": sum(value["sessions"] for day, value in days.items() if week_start <= day <= today),
        "activity": [{"date": day.isoformat(), **value} for day, value in sorted(days.items()) if start <= day <= today],
    }


@router.get("/stats", response_model=schemas.Stats)
def stats(timezone_name: str = Query("UTC", alias="timezone"), db: Session = Depends(get_db)):
    return activity_data(db, timezone_name)["stats"]


@router.get("/dashboard")
def dashboard(timezone_name: str = Query("UTC", alias="timezone"), db: Session = Depends(get_db)):
    goals = db.scalars(select(GoalModel).where(GoalModel.completed.is_(False)).options(selectinload(GoalModel.tasks)).order_by(GoalModel.position, GoalModel.id)).all()
    return {
        **activity_data(db, timezone_name),
        "queue": queue_items(db),
        "goals": [{"goal": schemas.Goal.model_validate(goal), "tasks": [schemas.Task.model_validate(task) for task in sorted(goal.tasks, key=lambda item: (item.position, item.id))]} for goal in goals],
    }
