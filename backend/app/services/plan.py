from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.models import GoalModel, TaskModel

def find_goal(db: Session, goal_id: int) -> GoalModel:
    goal = db.get(GoalModel, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


def find_task(db: Session, task_id: int) -> TaskModel:
    task = db.get(TaskModel, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def next_goal_position(db: Session) -> int:
    return (db.scalar(select(func.max(GoalModel.position))) or 0) + 1


def next_task_position(db: Session, goal_id: int, parent_id: int | None) -> int:
    statement = select(func.max(TaskModel.position)).where(
        TaskModel.goal_id == goal_id,
        TaskModel.parent_id == parent_id,
    )
    return (db.scalar(statement) or 0) + 1


def reopen_task_lineage(db: Session, task: TaskModel) -> None:
    """Reopen every container above a task whose work became active again."""
    parent_id = task.parent_id
    while parent_id is not None:
        parent = find_task(db, parent_id)
        parent.completed = False
        parent_id = parent.parent_id
    find_goal(db, task.goal_id).completed = False


def task_is_ready_to_close(db: Session, task: TaskModel) -> bool:
    children = db.scalars(
        select(TaskModel).where(TaskModel.parent_id == task.id)
    ).all()
    return bool(children) and all(child.completed for child in children)


def goal_is_ready_to_close(db: Session, goal: GoalModel) -> bool:
    roots = db.scalars(
        select(TaskModel).where(
            TaskModel.goal_id == goal.id,
            TaskModel.parent_id.is_(None),
        )
    ).all()
    return bool(roots) and all(task.completed for task in roots)


def task_plan_key(
    task: TaskModel,
    tasks_by_id: dict[int, TaskModel],
    goal_positions: dict[int, int],
) -> tuple[int, int, tuple[tuple[int, int], ...]]:
    """Sort a task by the visible direction and sibling order in the Plan view."""
    path = [(task.position, task.id)]
    parent_id = task.parent_id
    while parent_id is not None:
        parent = tasks_by_id[parent_id]
        path.append((parent.position, parent.id))
        parent_id = parent.parent_id
    path.reverse()
    return goal_positions.get(task.goal_id, 0), task.goal_id, tuple(path)



def complete_task(db: Session, task: TaskModel) -> None:
    """An explicit completion includes descendants, never ancestors."""
    tasks = db.scalars(select(TaskModel).where(TaskModel.goal_id == task.goal_id)).all()
    children_by_parent = {}
    for item in tasks:
        children_by_parent.setdefault(item.parent_id, []).append(item)
    pending = [task]
    visited = set()
    while pending:
        current = pending.pop()
        if current.id in visited:
            continue
        visited.add(current.id)
        current.completed = True
        pending.extend(children_by_parent.get(current.id, []))
