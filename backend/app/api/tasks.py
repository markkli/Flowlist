from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app import schemas
from app.database import get_db
from app.models import FocusSessionModel, FocusSessionTaskModel, GoalModel, TaskModel
from app.services.plan import find_goal, find_task, next_task_position, reopen_task_lineage, task_plan_key, complete_task
from app.ai import AIConfigurationError, suggest_subtasks

router = APIRouter()
MAX_DEPTH = 2

@router.get("/next-focus", response_model=schemas.NextFocus)
def get_next_focus(db: Session = Depends(get_db)):
    all_tasks = db.scalars(select(TaskModel)).all()
    tasks_by_id = {task.id: task for task in all_tasks}
    active_goals = db.scalars(select(GoalModel).where(GoalModel.completed.is_(False))).all()
    goal_positions = {goal.id: goal.position for goal in active_goals}
    parent_ids = {task.parent_id for task in all_tasks if task.parent_id is not None}
    candidates = [
        task for task in all_tasks if not task.completed and task.id not in parent_ids and task.goal_id in goal_positions
    ]
    if not candidates:
        raise HTTPException(status_code=404, detail="No unfinished focus task found")
    # The visible Plan order is the default suggestion; there is no hidden priority score.
    next_task = min(
        candidates,
        key=lambda task: task_plan_key(task, tasks_by_id, goal_positions),
    )
    return {"task": next_task, "goal": next_task.goal}


@router.get("/focus-options", response_model=list[schemas.FocusTaskOption])
def list_focus_options(db: Session = Depends(get_db)):
    """Offer every unfinished level, grouped in the same hierarchy as Plan."""
    all_tasks = db.scalars(select(TaskModel)).all()
    parent_ids = {task.parent_id for task in all_tasks if task.parent_id is not None}
    goals_by_id = {
        goal.id: goal for goal in db.scalars(select(GoalModel).where(GoalModel.completed.is_(False))).all()
    }
    candidates = [
        task for task in all_tasks if not task.completed and task.goal_id in goals_by_id
    ]
    tasks_by_id = {task.id: task for task in all_tasks}
    goal_positions = {goal.id: goal.position for goal in goals_by_id.values()}
    recent_rows = db.execute(
        select(
            FocusSessionTaskModel.task_id,
            func.max(FocusSessionModel.created_at),
        )
        .join(
            FocusSessionModel,
            FocusSessionModel.id == FocusSessionTaskModel.session_id,
        )
        .where(FocusSessionTaskModel.task_id.is_not(None), FocusSessionModel.deleted_at.is_(None))
        .group_by(FocusSessionTaskModel.task_id)
    ).all()
    last_focused = {
        task_id: created_at for task_id, created_at in recent_rows
    }
    candidates.sort(key=lambda task: task_plan_key(task, tasks_by_id, goal_positions))

    def ancestor_titles(task):
        titles = []
        parent_id = task.parent_id
        while parent_id is not None:
            parent = tasks_by_id[parent_id]
            titles.append(parent.title)
            parent_id = parent.parent_id
        return list(reversed(titles))

    return [
        schemas.FocusTaskOption(
            id=task.id,
            title=task.title,
            goal_id=task.goal_id,
            goal_title=goals_by_id[task.goal_id].title,
            goal_type=goals_by_id[task.goal_id].goal_type,
            parent_id=task.parent_id,
            depth=task.depth,
            position=task.position,
            ancestor_titles=ancestor_titles(task),
            has_children=task.id in parent_ids,
            last_focused_at=last_focused.get(task.id),
        )
        for task in candidates
    ]


@router.post("/tasks/{parent_id}/subtasks", response_model=schemas.Task)
def create_subtask(
    parent_id: int, task: schemas.TaskCreate, db: Session = Depends(get_db)
):
    parent = find_task(db, parent_id)
    if parent.goal.goal_type == "standalone":
        raise HTTPException(status_code=400, detail="The Tasks list does not support nested steps")
    if parent.parent_id is not None or parent.depth >= MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail="Subtasks cannot contain another level. Add a sibling subtask instead.",
        )
    new_task = TaskModel(
        goal_id=parent.goal_id,
        parent_id=parent.id,
        depth=parent.depth + 1,
        position=next_task_position(db, parent.goal_id, parent.id),
        **task.model_dump(),
    )
    reopen_task_lineage(db, new_task)
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@router.post("/tasks/{task_id}/breakdown", response_model=list[schemas.SuggestedSubtask])
def breakdown_task(task_id: int, db: Session = Depends(get_db)):
    task = find_task(db, task_id)
    if task.goal.goal_type == "standalone":
        raise HTTPException(status_code=400, detail="The Tasks list does not support AI breakdown")
    if task.parent_id is not None or task.depth >= MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail="Subtasks cannot contain another level. Add a sibling subtask instead.",
        )
    goal = find_goal(db, task.goal_id)
    try:
        return suggest_subtasks(goal.title, task.title)
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/tasks/reorder", response_model=list[schemas.Task])
def reorder_tasks(order: schemas.ReorderPayload, db: Session = Depends(get_db)):
    tasks = [find_task(db, task_id) for task_id in order.ordered_ids]
    first = tasks[0]
    siblings = db.scalars(
        select(TaskModel).where(
            TaskModel.goal_id == first.goal_id,
            TaskModel.parent_id == first.parent_id,
        )
    ).all()
    if set(order.ordered_ids) != {task.id for task in siblings}:
        raise HTTPException(
            status_code=400,
            detail="Reorder every task in this section exactly once",
        )
    if any(
        task.goal_id != first.goal_id or task.parent_id != first.parent_id
        for task in tasks
    ):
        raise HTTPException(status_code=400, detail="Tasks must share one parent")
    for position, task in enumerate(tasks, start=1):
        task.position = position
    db.commit()
    return tasks


@router.patch("/tasks/{task_id}", response_model=schemas.Task)
def update_task(
    task_id: int, updates: schemas.TaskUpdate, db: Session = Depends(get_db)
):
    task = find_task(db, task_id)
    changes = updates.model_dump(exclude_unset=True)
    if changes.get("completed") is True:
        complete_task(db, task)
    if changes.get("completed") is False:
        reopen_task_lineage(db, task)
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = find_task(db, task_id)
    db.delete(task)
    db.commit()
    return {"deleted": True}

