import os
from datetime import date, timedelta

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

import schemas
from ai import AIConfigurationError, suggest_subtasks
from database import Base, engine, get_db
from models import FocusSessionModel, GoalModel, TaskModel

Base.metadata.create_all(bind=engine)

MAX_DEPTH = 3

app = FastAPI(title="Flowlist API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# i left a note here

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
def health(db: Session = Depends(get_db)):
    # A tiny query confirms the app can actually talk to PostgreSQL.
    db.execute(select(1))
    return {
        "ok": True,
        "database": "connected",
        "ai_breakdown_configured": bool(os.getenv("OPENAI_API_KEY")),
    }


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


@app.post("/tasks/{parent_id}/subtasks", response_model=schemas.Task)
def create_subtask(
    parent_id: int, task: schemas.TaskCreate, db: Session = Depends(get_db)
):
    parent = find_task(db, parent_id)
    if parent.depth >= MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum depth of {MAX_DEPTH} reached; this task can't have subtasks.",
        )
    new_task = TaskModel(
        goal_id=parent.goal_id,
        parent_id=parent.id,
        depth=parent.depth + 1,
        **task.model_dump(),
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@app.post("/tasks/{task_id}/breakdown", response_model=list[schemas.SuggestedSubtask])
def breakdown_task(task_id: int, db: Session = Depends(get_db)):
    task = find_task(db, task_id)
    if task.depth >= MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum depth of {MAX_DEPTH} reached; this task can't have subtasks.",
        )
    goal = find_goal(db, task.goal_id)
    try:
        return suggest_subtasks(goal.title, task.title)
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


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


@app.post("/tasks/{task_id}/sessions", response_model=schemas.FocusSession)
def log_session(
    task_id: int, session: schemas.FocusSessionCreate, db: Session = Depends(get_db)
):
    task = find_task(db, task_id)
    new_session = FocusSessionModel(
        task_id=task_id,
        planned_minutes=task.estimated_minutes,
        **session.model_dump(),
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session


@app.get("/sessions", response_model=list[schemas.FocusSession])
def list_sessions(db: Session = Depends(get_db)):
    return db.scalars(
        select(FocusSessionModel).order_by(FocusSessionModel.created_at.desc())
    ).all()


@app.get("/stats", response_model=schemas.Stats)
def get_stats(db: Session = Depends(get_db)):
    session_dates = set(
        db.scalars(
            select(func.distinct(cast(FocusSessionModel.created_at, Date)))
        ).all()
    )

    streak = 0
    cursor = date.today()
    if cursor not in session_dates:
        cursor -= timedelta(days=1)
    while cursor in session_dates:
        streak += 1
        cursor -= timedelta(days=1)

    total_sessions = db.scalar(select(func.count(FocusSessionModel.id))) or 0
    total_minutes = db.scalar(select(func.sum(FocusSessionModel.actual_minutes))) or 0

    return schemas.Stats(
        current_streak=streak,
        total_sessions=total_sessions,
        total_minutes=total_minutes,
    )
