from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import schemas
from app.database import get_db
from app.models import GoalModel, TaskModel
from app.services.plan import find_goal, next_goal_position, next_task_position, goal_is_ready_to_close

router = APIRouter()

@router.post("/goals", response_model=schemas.Goal)
def create_goal(goal: schemas.GoalCreate, db: Session = Depends(get_db)):
    new_goal = GoalModel(position=next_goal_position(db), **goal.model_dump())
    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)
    return new_goal


@router.get("/goals", response_model=list[schemas.Goal])
def list_goals(db: Session = Depends(get_db)):
    return db.scalars(select(GoalModel).order_by(GoalModel.position, GoalModel.id)).all()


@router.post("/goals/reorder", response_model=list[schemas.Goal])
def reorder_goals(order: schemas.ReorderPayload, db: Session = Depends(get_db)):
    goals = db.scalars(select(GoalModel)).all()
    goals_by_id = {goal.id: goal for goal in goals}
    if set(order.ordered_ids) != set(goals_by_id):
        raise HTTPException(status_code=400, detail="Reorder every direction exactly once")
    for position, goal_id in enumerate(order.ordered_ids, start=1):
        goals_by_id[goal_id].position = position
    db.commit()
    return [goals_by_id[goal_id] for goal_id in order.ordered_ids]


@router.get("/goals/{goal_id}", response_model=schemas.Goal)
def get_goal(goal_id: int, db: Session = Depends(get_db)):
    return find_goal(db, goal_id)


@router.patch("/goals/{goal_id}", response_model=schemas.Goal)
def update_goal(
    goal_id: int, updates: schemas.GoalUpdate, db: Session = Depends(get_db)
):
    goal = find_goal(db, goal_id)
    changes = updates.model_dump(exclude_unset=True)
    if changes.get("completed") is True:
        if goal.goal_type == "standalone":
            raise HTTPException(status_code=400, detail="The shared Tasks list stays active")
        if not goal_is_ready_to_close(db, goal):
            raise HTTPException(
                status_code=409,
                detail="Complete every top-level section before closing this direction",
            )
    if "goal_type" in changes and changes["goal_type"] != goal.goal_type and (goal.goal_type == "standalone" or changes["goal_type"] == "standalone"):
        raise HTTPException(status_code=400, detail="The shared Tasks list cannot change type")
    for field, value in changes.items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    goal = find_goal(db, goal_id)
    db.delete(goal)
    db.commit()
    return {"deleted": True}


@router.post("/goals/{goal_id}/tasks", response_model=schemas.Task)
def create_task(
    goal_id: int, task: schemas.TaskCreate, db: Session = Depends(get_db)
):
    goal = find_goal(db, goal_id)
    goal.completed = False
    new_task = TaskModel(
        goal_id=goal_id,
        position=next_task_position(db, goal_id, None),
        **task.model_dump(),
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@router.post("/standalone-tasks", response_model=schemas.Task)
def create_standalone_task(
    task: schemas.TaskCreate, db: Session = Depends(get_db)
):
    """Add a simple task to the shared task list."""
    goal = db.scalar(
        select(GoalModel)
        .where(GoalModel.goal_type == "standalone")
        .order_by(GoalModel.id)
    )
    if goal is None:
        goal = GoalModel(
            title="Tasks",
            goal_type="standalone",
            position=next_goal_position(db),
        )
        db.add(goal)
        db.flush()
    elif goal.title == "Standalone tasks":
        goal.title = "Tasks"
    new_task = TaskModel(
        goal_id=goal.id,
        position=next_task_position(db, goal.id, None),
        **task.model_dump(),
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@router.get("/goals/{goal_id}/tasks", response_model=list[schemas.Task])
def list_tasks(goal_id: int, db: Session = Depends(get_db)):
    find_goal(db, goal_id)
    return db.scalars(
        select(TaskModel)
        .where(TaskModel.goal_id == goal_id)
        .order_by(TaskModel.position, TaskModel.id)
    ).all()


