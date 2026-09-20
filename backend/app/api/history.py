from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session, selectinload
from app import schemas
from app.database import get_db
from app.models import FocusSessionModel, FocusSessionTaskModel, FocusBlockModel, GoalModel, TaskModel, FocusQueueModel
from app.services.history import midnight_utc, session_days, zone_for
from app.services.titles import clean_history_title

router = APIRouter()


@router.get("/history/week")
def week(start: date, timezone_name: str = Query("UTC", alias="timezone"), db: Session = Depends(get_db)):
    zone = zone_for(timezone_name)
    end = start + timedelta(days=7)
    lower, upper = midnight_utc(start, zone), midnight_utc(end, zone)
    sessions = db.scalars(select(FocusSessionModel).where(
        FocusSessionModel.deleted_at.is_(None),
        or_(
            FocusSessionModel.blocks.any(and_(FocusBlockModel.started_at < upper, FocusBlockModel.ended_at > lower)),
            and_(FocusSessionModel.started_at.is_(None), FocusSessionModel.created_at >= lower, FocusSessionModel.created_at < upper),
            and_(~FocusSessionModel.blocks.any(), FocusSessionModel.started_at >= lower, FocusSessionModel.started_at < upper),
        ),
    ).options(selectinload(FocusSessionModel.blocks), selectinload(FocusSessionModel.attributions))).all()
    days = {start + timedelta(days=i): {"minutes": 0, "seconds": 0, "session_ids": []} for i in range(7)}
    for session in sessions:
        for day, totals in session_days(session, zone).items():
            if day in days:
                days[day]["minutes"] += totals["minutes"]
                days[day]["seconds"] += totals["seconds"]
                days[day]["session_ids"].append(session.id)
    return {"days": [{"date": day.isoformat(), **row} for day, row in days.items()],
            "sessions": [schemas.FocusSession.model_validate(session) for session in sessions]}


@router.get("/history/task-options")
def task_options(db: Session = Depends(get_db)):
    tasks = db.scalars(select(TaskModel).options(selectinload(TaskModel.goal)).order_by(TaskModel.goal_id, TaskModel.position, TaskModel.id)).all()
    return [{**schemas.Task.model_validate(task).model_dump(), "goal_title": task.goal.title, "goal_type": task.goal.goal_type} for task in tasks]


@router.patch("/sessions/{session_id}", response_model=schemas.FocusSession)
def edit_session(session_id: int, payload: schemas.HistoryEdit, db: Session = Depends(get_db)):
    session = db.get(FocusSessionModel, session_id)
    if session is None or session.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Focus record not found")
    existing = {row.id: row for row in session.attributions}
    rows, seen = [], set()
    for item in payload.attributions:
        if item.attribution_id is not None:
            row = existing.get(item.attribution_id)
            if row is None:
                raise HTTPException(status_code=422, detail="An attribution no longer belongs to this ritual. Reopen the record.")
            key = ("task", row.task_id) if row.task_id else ("snapshot", row.id)
        else:
            task = db.get(TaskModel, item.task_id)
            if task is None:
                raise HTTPException(status_code=404, detail="A selected task no longer exists. Your changes have not been saved.")
            key = ("task", task.id)
            row = FocusSessionTaskModel(task_id=task.id, task_title=task.title, goal_title=task.goal.title)
        if key in seen:
            raise HTTPException(status_code=422, detail="Each task can appear only once in a ritual")
        seen.add(key)
        row.completed = item.completed
        rows.append(row)
    # Atomic revision check prevents another editor or an AI title from silently
    # overwriting a correction. No Plan task state is changed here.
    updated = db.execute(update(FocusSessionModel).where(
        FocusSessionModel.id == session_id, FocusSessionModel.revision == payload.revision,
        FocusSessionModel.deleted_at.is_(None),
    ).values(revision=payload.revision + 1).execution_options(synchronize_session=False))
    if updated.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This record changed in another window. Your draft is still here; reopen the record to review the latest version.")
    session.summary = payload.summary.strip() if payload.summary and payload.summary.strip() else None
    session.attributions = rows
    if session.summary:
        session.title = clean_history_title(session.summary)
    elif len(rows) == 1:
        session.title = clean_history_title(rows[0].task_title)
    elif rows and len({row.goal_title for row in rows}) == 1 and rows[0].goal_title:
        session.title = clean_history_title(f"{rows[0].goal_title} focus")
    else:
        session.title = "Focused work" if rows else "General focus"
    db.commit()
    db.refresh(session)
    return session


@router.get("/export")
def export_data(db: Session = Depends(get_db)):
    """Portable data only: never environment variables, credentials or local drafts."""
    sessions = db.scalars(select(FocusSessionModel).options(selectinload(FocusSessionModel.blocks), selectinload(FocusSessionModel.attributions)).order_by(FocusSessionModel.id)).all()
    data = {
        "format": "flowlist", "schema_version": 1, "timestamps": "UTC",
        "exported_at": datetime.now(timezone.utc),
        "goals": [schemas.Goal.model_validate(row) for row in db.scalars(select(GoalModel).order_by(GoalModel.id))],
        "tasks": [schemas.Task.model_validate(row) for row in db.scalars(select(TaskModel).order_by(TaskModel.id))],
        "queue": [{"task_id": row.task_id, "position": row.position} for row in db.scalars(select(FocusQueueModel).order_by(FocusQueueModel.position))],
        "sessions": [{**schemas.FocusSession.model_validate(row).model_dump(), "client_id": row.client_id, "title": row.title, "deleted_at": row.deleted_at} for row in sessions],
    }
    return JSONResponse(jsonable_encoder(data), headers={"Content-Disposition": 'attachment; filename="flowlist-export.json"'})
