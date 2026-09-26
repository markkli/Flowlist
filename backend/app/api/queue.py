from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import schemas
from app.database import get_db
from app.models import FocusQueueModel, GoalModel, TaskModel

router = APIRouter()


class QueueUpdate(BaseModel):
    ordered_ids: list[Annotated[int, Field(strict=True, gt=0)]]

    @field_validator("ordered_ids")
    @classmethod
    def reject_duplicate_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("Queue task IDs must be unique")
        return value


def eligible_task_conditions():
    return (
        TaskModel.completed.is_(False),
        GoalModel.completed.is_(False),
    )


def queue_items(db: Session) -> list[schemas.NextFocus]:
    """Hide work that stopped being actionable, retaining membership for undo."""
    rows = db.execute(
        select(TaskModel, GoalModel)
        .join(GoalModel, GoalModel.id == TaskModel.goal_id)
        .join(FocusQueueModel, FocusQueueModel.task_id == TaskModel.id)
        .where(*eligible_task_conditions())
        .order_by(FocusQueueModel.position, FocusQueueModel.task_id)
    ).all()
    return [
        schemas.NextFocus(task=schemas.Task.model_validate(task), goal=schemas.Goal.model_validate(goal))
        for task, goal in rows
    ]


def validate_queue_tasks(db: Session, task_ids: list[int]) -> None:
    if not task_ids:
        return
    existing_ids = set(db.scalars(select(TaskModel.id).where(TaskModel.id.in_(task_ids))))
    if existing_ids != set(task_ids):
        raise HTTPException(status_code=404, detail="One or more queue tasks no longer exist")
    eligible_ids = set(
        db.scalars(
            select(TaskModel.id)
            .join(GoalModel, GoalModel.id == TaskModel.goal_id)
            .where(TaskModel.id.in_(task_ids), *eligible_task_conditions())
        )
    )
    if eligible_ids != existing_ids:
        raise HTTPException(
            status_code=409,
            detail="Choose unfinished tasks from active projects",
        )


@router.get("/queue", response_model=list[schemas.NextFocus])
def get_queue(db: Session = Depends(get_db)):
    return queue_items(db)


@router.put("/queue", response_model=list[schemas.NextFocus])
def replace_queue(order: QueueUpdate, db: Session = Depends(get_db)):
    # Validate the whole request before replacing anything: a stale picker must
    # not silently discard the user's existing shortlist.
    validate_queue_tasks(db, order.ordered_ids)
    db.execute(delete(FocusQueueModel))
    db.add_all([
        FocusQueueModel(task_id=task_id, position=position)
        for position, task_id in enumerate(order.ordered_ids, start=1)
    ])
    db.commit()
    return queue_items(db)


@router.post("/queue/{task_id}", response_model=list[schemas.NextFocus])
def add_to_queue(task_id: int, db: Session = Depends(get_db)):
    validate_queue_tasks(db, [task_id])
    if db.get(FocusQueueModel, task_id) is None:
        position = (db.scalar(select(func.max(FocusQueueModel.position))) or 0) + 1
        db.add(FocusQueueModel(task_id=task_id, position=position))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Two windows may add the same task concurrently. A successful
            # insert by the other request fulfills this idempotent operation.
            if db.get(FocusQueueModel, task_id) is None:
                raise
    return queue_items(db)


@router.delete("/queue/{task_id}", response_model=list[schemas.NextFocus])
def remove_from_queue(task_id: int, db: Session = Depends(get_db)):
    db.execute(delete(FocusQueueModel).where(FocusQueueModel.task_id == task_id))
    db.commit()
    return queue_items(db)
