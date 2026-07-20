from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

import schemas
from database import Base, engine, get_db
from models import GoalModel, TaskModel

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Flowlist API")


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


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/goals", response_model=schemas.Goal)
def create_goal(goal: schemas.GoalCreate, db: Session = Depends(get_db)):
    new_goal = GoalModel(**goal.model_dump())
    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)
    return new_goal


@app.get("/goals", response_model=list[schemas.Goal])
def list_goals(db: Session = Depends(get_db)):
    return db.scalars(select(GoalModel)).all()


@app.get("/goals/{goal_id}", response_model=schemas.Goal)
def get_goal(goal_id: int, db: Session = Depends(get_db)):
    return find_goal(db, goal_id)


@app.patch("/goals/{goal_id}", response_model=schemas.Goal)
def update_goal(
    goal_id: int, updates: schemas.GoalUpdate, db: Session = Depends(get_db)
):
    goal = find_goal(db, goal_id)
    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@app.delete("/goals/{goal_id}")
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    goal = find_goal(db, goal_id)
    db.delete(goal)
    db.commit()
    return {"deleted": True}


@app.post("/goals/{goal_id}/tasks", response_model=schemas.Task)
def create_task(
    goal_id: int, task: schemas.TaskCreate, db: Session = Depends(get_db)
):
    find_goal(db, goal_id)
    new_task = TaskModel(goal_id=goal_id, **task.model_dump())
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@app.get("/goals/{goal_id}/tasks", response_model=list[schemas.Task])
def list_tasks(goal_id: int, db: Session = Depends(get_db)):
    find_goal(db, goal_id)
    return db.scalars(
        select(TaskModel).where(TaskModel.goal_id == goal_id)
    ).all()


@app.patch("/tasks/{task_id}", response_model=schemas.Task)
def update_task(
    task_id: int, updates: schemas.TaskUpdate, db: Session = Depends(get_db)
):
    task = find_task(db, task_id)
    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = find_task(db, task_id)
    db.delete(task)
    db.commit()
    return {"deleted": True}
