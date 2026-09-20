import os
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from app import schemas
from app.database import get_db
from app.models import FocusSessionModel, FocusSessionTaskModel, FocusBlockModel, TaskModel
from app.services.plan import complete_task
from app.services.titles import build_focus_title, improve_focus_title

router = APIRouter()

@router.post("/sessions", response_model=schemas.FocusSession)
def log_session(session: schemas.FocusSessionCreate, background: BackgroundTasks, db: Session = Depends(get_db)):
    if session.client_id:
        existing = db.scalar(select(FocusSessionModel).where(FocusSessionModel.client_id == session.client_id))
        if existing:
            if existing.deleted_at:
                raise HTTPException(status_code=409, detail="This ritual was already saved and deleted. Restore it from History instead.")
            return existing
    selections_by_task_id = {selection.task_id: selection for selection in session.tasks}
    tasks_by_id = {
        task.id: task
        for task in db.scalars(
            select(TaskModel).where(TaskModel.id.in_(selections_by_task_id))
        ).all()
    }
    missing_task_ids = selections_by_task_id.keys() - tasks_by_id.keys()
    if missing_task_ids:
        raise HTTPException(status_code=404, detail="Task not found")

    selected_tasks = [tasks_by_id[item.task_id] for item in session.tasks]
    history_title, stored_summary = build_focus_title(session.summary, selected_tasks)

    new_session = FocusSessionModel(
        client_id=session.client_id,
        title=history_title,
        summary=stored_summary,
        planned_minutes=session.planned_minutes,
        actual_minutes=session.actual_minutes,
        completed=session.completed,
        started_at=session.started_at, ended_at=session.ended_at,
        blocks=[FocusBlockModel(**block.model_dump()) for block in (session.blocks or [])],
    )
    db.add(new_session)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(FocusSessionModel).where(FocusSessionModel.client_id == session.client_id)) if session.client_id else None
        if existing and existing.deleted_at is None:
            return existing
        raise HTTPException(status_code=409, detail="This ritual has already been saved")
    # Use the same downward completion rule as the Plan. A selection marked
    # worked-on only does not reopen a descendant completed by its parent.
    for task in sorted(selected_tasks, key=lambda item: item.depth):
        if selections_by_task_id[task.id].completed:
            complete_task(db, task)
    for selection in session.tasks:
        task = tasks_by_id[selection.task_id]
        new_session.attributions.append(
            FocusSessionTaskModel(
                task_id=task.id,
                task_title=task.title,
                goal_title=task.goal.title,
                completed=selection.completed,
            )
        )
    db.commit()
    db.refresh(new_session)
    if os.getenv("OPENAI_API_KEY") and ((stored_summary and (len(stored_summary) > 80 or len(stored_summary.split()) > 12)) or (not stored_summary and len(selected_tasks) > 1)):
        background.add_task(improve_focus_title, new_session.id, stored_summary, [f"{task.title} — {task.goal.title}" for task in selected_tasks])
    return new_session


@router.get("/sessions", response_model=list[schemas.FocusSession])
def list_sessions(limit: int = Query(50, ge=1, le=100), before_id: int | None = Query(None, ge=1), deleted: bool = False, db: Session = Depends(get_db)):
    return db.scalars(
        select(FocusSessionModel)
        .where(FocusSessionModel.deleted_at.is_not(None) if deleted else FocusSessionModel.deleted_at.is_(None), FocusSessionModel.id < before_id if before_id else True)
        .options(selectinload(FocusSessionModel.attributions), selectinload(FocusSessionModel.blocks))
        .order_by(FocusSessionModel.id.desc()).limit(limit)
    ).all()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(FocusSessionModel, session_id)
    if session is None or session.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Focus session not found")
    session.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"deleted": True}



@router.post("/sessions/{session_id}/restore", response_model=schemas.FocusSession)
def restore_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(FocusSessionModel, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Focus session not found")
    session.deleted_at = None
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=schemas.FocusSession)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(FocusSessionModel, session_id)
    if session is None or session.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Focus record not found")
    return session
