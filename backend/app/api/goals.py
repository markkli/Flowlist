from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Header
from app.services.mutations import create_once
from sqlalchemy import select, delete
from sqlalchemy.orm import Session, selectinload
from app import schemas
from app.database import get_db
from app.models import GoalModel, TaskModel
from app.services.plan import find_goal, next_goal_position, next_task_position, goal_is_ready_to_close

router = APIRouter()

@router.post("/goals", response_model=schemas.Goal)
def create_goal(goal: schemas.GoalCreate, db: Session = Depends(get_db), idempotency_key: UUID | None = Header(default=None)):
    def create():
        new_goal = GoalModel(position=next_goal_position(db), **goal.model_dump())
        db.add(new_goal)
        return new_goal
    return create_once(db, idempotency_key, "/goals", goal, schemas.Goal, create)


@router.get("/goals", response_model=list[schemas.GoalWithTasks | schemas.Goal])
def list_goals(include_tasks: bool = False, db: Session = Depends(get_db)):
    query = select(GoalModel).order_by(GoalModel.position, GoalModel.id)
    if include_tasks:
        query = query.options(selectinload(GoalModel.tasks))
    goals = db.scalars(query).all()
    schema = schemas.GoalWithTasks if include_tasks else schemas.Goal
    return [schema.model_validate(goal) for goal in goals]


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


@router.post("/goals/with-task", response_model=schemas.GoalWithTasks)
def create_project_with_task(payload: schemas.ProjectWithTask, db: Session = Depends(get_db), idempotency_key: UUID | None = Header(default=None)):
    def create():
        if payload.goal_type != "project":
            raise HTTPException(422, "Choose a project for this action")
        goal = GoalModel(title=payload.title, description=payload.description, goal_type="project", position=next_goal_position(db))
        db.add(goal)
        db.flush()
        db.add(TaskModel(goal_id=goal.id, title=payload.task.title, position=1))
        return goal
    return create_once(db, idempotency_key, "/goals/with-task", payload, schemas.GoalWithTasks, create)


@router.post("/guide/example", response_model=schemas.GoalWithTasks)
def guide_example(db: Session = Depends(get_db)):
    # A unique account-specific key makes retries and concurrent tabs idempotent.
    key = f"guide:{db.info.get('owner_id') or 'local'}"
    goal = db.scalar(select(GoalModel).where(GoalModel.example_key == key))
    if goal is not None:
        return goal
    from sqlalchemy.exc import IntegrityError
    goal = GoalModel(title="Learn Flowlist", goal_type="project", example_key=key, position=next_goal_position(db))
    db.add(goal)
    try:
        db.flush()
        for position, (title, child) in enumerate([
            ("Understand Pomodoro", "Customize the timer"),
            ("Organize your work", "Star a priority"),
            ("Review a focus session", None),
        ]):
            task = TaskModel(goal_id=goal.id, title=title, position=position)
            db.add(task)
            db.flush()
            if child:
                db.add(TaskModel(goal_id=goal.id, parent_id=task.id, depth=2, title=child, position=0))
        db.commit()
    except IntegrityError:
        db.rollback()
        goal = db.scalar(select(GoalModel).where(GoalModel.example_key == key))
        if goal is None:
            raise
    db.refresh(goal)
    return goal


@router.delete("/guide/example/{goal_id}")
def remove_guide_example(goal_id: int, db: Session = Depends(get_db)):
    goal = find_goal(db, goal_id)
    if not goal.is_example:
        raise HTTPException(409, "This is not a guide example")
    db.execute(delete(GoalModel).where(GoalModel.id == goal.id))
    db.commit()
    return {"deleted": True}


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
    goal_id: int, task: schemas.TaskCreate, db: Session = Depends(get_db), idempotency_key: UUID | None = Header(default=None)
):
    def create():
        goal = find_goal(db, goal_id)
        goal.completed = False
        new_task = TaskModel(
            goal_id=goal_id,
            position=next_task_position(db, goal_id, None),
            **task.model_dump(),
        )
        db.add(new_task)
        return new_task
    return create_once(db, idempotency_key, f"/goals/{goal_id}/tasks", task, schemas.Task, create)


@router.post("/standalone-tasks", response_model=schemas.Task)
def create_standalone_task(
    task: schemas.TaskCreate, db: Session = Depends(get_db), idempotency_key: UUID | None = Header(default=None)
):
    def create():
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
        return new_task
    return create_once(db, idempotency_key, "/standalone-tasks", task, schemas.Task, create)


@router.get("/goals/{goal_id}/tasks", response_model=list[schemas.Task])
def list_tasks(goal_id: int, db: Session = Depends(get_db)):
    find_goal(db, goal_id)
    return db.scalars(
        select(TaskModel)
        .where(TaskModel.goal_id == goal_id)
        .order_by(TaskModel.position, TaskModel.id)
    ).all()


