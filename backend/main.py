import os
import re
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

import schemas
from ai import (
    AIConfigurationError,
    suggest_learning_questions,
    suggest_learning_tasks,
    suggest_focus_title,
    suggest_subtasks,
)
from database import get_db
from models import FocusSessionModel, FocusSessionTaskModel, GoalModel, TaskModel

MAX_DEPTH = 3
SHORT_FOCUS_SUMMARY_LENGTH = 80
SHORT_FOCUS_SUMMARY_WORDS = 12

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
) -> tuple[int, tuple[tuple[int, int], ...]]:
    """Sort a task by the visible direction and sibling order in the Plan view."""
    path = [(task.position, task.id)]
    parent_id = task.parent_id
    while parent_id is not None:
        parent = tasks_by_id[parent_id]
        path.append((parent.position, parent.id))
        parent_id = parent.parent_id
    path.reverse()
    return goal_positions.get(task.goal_id, 0), tuple(path)


def clean_history_title(value: str, max_length: int = 100) -> str:
    """Normalize user/AI copy without destroying intentional acronym casing."""
    title = " ".join(value.split()).strip(" \t\n\r\"'`.,;:!?-–—")
    if not title:
        return "General focus"
    title = title[0].upper() + title[1:]
    if len(title) <= max_length:
        return title
    shortened = title[: max_length - 1].rsplit(" ", 1)[0]
    return f"{shortened or title[: max_length - 1]}…"


def looks_like_gibberish(value: str) -> bool:
    compact = re.sub(r"\s+", "", value)
    letters = "".join(character.lower() for character in compact if character.isalpha())
    if not letters or len(letters) < max(2, len(compact) // 3):
        return True
    if len(letters) >= 3 and len(set(letters)) <= 2:
        return True
    if len(letters) >= 6 and sum(character in "aeiouy" for character in letters) / len(letters) < 0.18:
        return True
    return False


def fallback_focus_title(tasks: list[TaskModel]) -> str:
    if not tasks:
        return "General focus"
    if len(tasks) == 1:
        return clean_history_title(tasks[0].title)
    goal_titles = {task.goal.title for task in tasks}
    if len(goal_titles) == 1:
        return clean_history_title(f"{next(iter(goal_titles))} focus")
    return "Focused work"


def build_focus_title(summary: str | None, tasks: list[TaskModel]) -> tuple[str, str | None]:
    """Choose a useful title while keeping optional AI failure non-blocking."""
    clean_summary = " ".join(summary.split()) if summary else None
    if clean_summary and looks_like_gibberish(clean_summary):
        return "General focus", None
    if clean_summary and (
        len(clean_summary) <= SHORT_FOCUS_SUMMARY_LENGTH
        and len(clean_summary.split()) <= SHORT_FOCUS_SUMMARY_WORDS
    ):
        return clean_history_title(clean_summary), clean_summary

    task_contexts = [f"{task.title} — {task.goal.title}" for task in tasks]
    if clean_summary or task_contexts:
        try:
            generated = clean_history_title(
                suggest_focus_title(clean_summary, task_contexts)
            )
            if not looks_like_gibberish(generated):
                return generated, clean_summary
        except Exception:
            # History must remain saveable if the optional title agent is unavailable.
            pass
    if clean_summary:
        return clean_history_title(clean_summary), clean_summary
    return fallback_focus_title(tasks), None


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
    new_goal = GoalModel(position=next_goal_position(db), **goal.model_dump())
    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)
    return new_goal


@app.get("/goals", response_model=list[schemas.Goal])
def list_goals(db: Session = Depends(get_db)):
    return db.scalars(select(GoalModel).order_by(GoalModel.position, GoalModel.id)).all()


@app.post("/goals/reorder", response_model=list[schemas.Goal])
def reorder_goals(order: schemas.ReorderPayload, db: Session = Depends(get_db)):
    goals = db.scalars(select(GoalModel)).all()
    goals_by_id = {goal.id: goal for goal in goals}
    if set(order.ordered_ids) != set(goals_by_id):
        raise HTTPException(status_code=400, detail="Reorder every direction exactly once")
    for position, goal_id in enumerate(order.ordered_ids, start=1):
        goals_by_id[goal_id].position = position
    db.commit()
    return [goals_by_id[goal_id] for goal_id in order.ordered_ids]


@app.get("/goals/{goal_id}", response_model=schemas.Goal)
def get_goal(goal_id: int, db: Session = Depends(get_db)):
    return find_goal(db, goal_id)


@app.patch("/goals/{goal_id}", response_model=schemas.Goal)
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
    for field, value in changes.items():
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


@app.post("/standalone-tasks", response_model=schemas.Task)
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


@app.get("/goals/{goal_id}/tasks", response_model=list[schemas.Task])
def list_tasks(goal_id: int, db: Session = Depends(get_db)):
    find_goal(db, goal_id)
    return db.scalars(
        select(TaskModel)
        .where(TaskModel.goal_id == goal_id)
        .order_by(TaskModel.position, TaskModel.id)
    ).all()


@app.post("/goals/{goal_id}/breakdown/questions", response_model=list[schemas.ClarificationQuestion])
def learning_breakdown_questions(goal_id: int, db: Session = Depends(get_db)):
    goal = find_goal(db, goal_id)
    if goal.goal_type != "learning":
        raise HTTPException(status_code=400, detail="Only learning goals can be broken down.")
    try:
        return suggest_learning_questions(goal.title, goal.description)
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/goals/{goal_id}/breakdown", response_model=list[schemas.SuggestedSubtask])
def breakdown_learning_goal(
    goal_id: int, request: schemas.LearningBreakdownRequest, db: Session = Depends(get_db)
):
    goal = find_goal(db, goal_id)
    if goal.goal_type != "learning":
        raise HTTPException(status_code=400, detail="Only learning goals can be broken down.")
    try:
        return suggest_learning_tasks(
            goal.title, goal.description, [answer.model_dump() for answer in request.answers]
        )
    except AIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/next-focus", response_model=schemas.NextFocus)
def get_next_focus(db: Session = Depends(get_db)):
    all_tasks = db.scalars(select(TaskModel)).all()
    tasks_by_id = {task.id: task for task in all_tasks}
    goal_positions = {
        goal.id: goal.position for goal in db.scalars(select(GoalModel)).all()
    }
    parent_ids = {task.parent_id for task in all_tasks if task.parent_id is not None}
    candidates = [
        task for task in all_tasks if not task.completed and task.id not in parent_ids
    ]
    if not candidates:
        raise HTTPException(status_code=404, detail="No unfinished focus task found")
    # The visible Plan order is the default suggestion; there is no hidden priority score.
    next_task = min(
        candidates,
        key=lambda task: task_plan_key(task, tasks_by_id, goal_positions),
    )
    return {"task": next_task, "goal": next_task.goal}


@app.get("/focus-options", response_model=list[schemas.FocusTaskOption])
def list_focus_options(db: Session = Depends(get_db)):
    """Return unfinished leaf tasks in a useful post-session attribution order."""
    all_tasks = db.scalars(select(TaskModel)).all()
    parent_ids = {task.parent_id for task in all_tasks if task.parent_id is not None}
    candidates = [
        task for task in all_tasks if not task.completed and task.id not in parent_ids
    ]
    tasks_by_id = {task.id: task for task in all_tasks}
    goal_positions = {
        goal.id: goal.position for goal in db.scalars(select(GoalModel)).all()
    }
    recent_rows = db.execute(
        select(
            FocusSessionTaskModel.task_id,
            func.max(FocusSessionModel.created_at),
            func.max(FocusSessionModel.id),
        )
        .join(
            FocusSessionModel,
            FocusSessionModel.id == FocusSessionTaskModel.session_id,
        )
        .where(FocusSessionTaskModel.task_id.is_not(None))
        .group_by(FocusSessionTaskModel.task_id)
    ).all()
    last_focused = {
        task_id: created_at for task_id, created_at, _session_id in recent_rows
    }
    last_session_ids = {
        task_id: session_id for task_id, _created_at, session_id in recent_rows
    }
    candidates.sort(
        key=lambda task: (
            0 if task.id in last_session_ids else 1,
            -last_session_ids.get(task.id, 0),
            task_plan_key(task, tasks_by_id, goal_positions),
        )
    )
    return [
        schemas.FocusTaskOption(
            id=task.id,
            title=task.title,
            goal_id=task.goal_id,
            goal_title=task.goal.title,
            last_focused_at=last_focused.get(task.id),
        )
        for task in candidates
    ]


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
        position=next_task_position(db, parent.goal_id, parent.id),
        **task.model_dump(),
    )
    reopen_task_lineage(db, new_task)
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


@app.post("/tasks/reorder", response_model=list[schemas.Task])
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


@app.patch("/tasks/{task_id}", response_model=schemas.Task)
def update_task(
    task_id: int, updates: schemas.TaskUpdate, db: Session = Depends(get_db)
):
    task = find_task(db, task_id)
    changes = updates.model_dump(exclude_unset=True)
    if changes.get("completed") is True:
        children_exist = db.scalar(
            select(TaskModel.id).where(TaskModel.parent_id == task.id).limit(1)
        )
        if children_exist is not None and not task_is_ready_to_close(db, task):
            raise HTTPException(
                status_code=409,
                detail="Complete every child before closing this section",
            )
    if changes.get("completed") is False:
        reopen_task_lineage(db, task)
    for field, value in changes.items():
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


@app.post("/sessions", response_model=schemas.FocusSession)
def log_session(session: schemas.FocusSessionCreate, db: Session = Depends(get_db)):
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
        title=history_title,
        summary=stored_summary,
        planned_minutes=session.planned_minutes,
        actual_minutes=session.actual_minutes,
        completed=session.completed,
    )
    db.add(new_session)
    db.flush()
    for selection in session.tasks:
        task = tasks_by_id[selection.task_id]
        if selection.completed:
            task.completed = True
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
    return new_session


@app.get("/sessions", response_model=list[schemas.FocusSession])
def list_sessions(db: Session = Depends(get_db)):
    return db.scalars(
        select(FocusSessionModel)
        .options(selectinload(FocusSessionModel.attributions))
        .order_by(FocusSessionModel.created_at.desc(), FocusSessionModel.id.desc())
    ).all()


@app.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(FocusSessionModel, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Focus session not found")
    db.delete(session)
    db.commit()
    return {"deleted": True}


@app.get("/stats", response_model=schemas.Stats)
def get_stats(db: Session = Depends(get_db)):
    session_dates = {
        created_at.date()
        for created_at in db.scalars(select(FocusSessionModel.created_at)).all()
    }

    streak = 0
    # Session timestamps are stored in UTC, so streak boundaries must use the
    # same clock. User-specific timezones can be introduced with accounts later.
    cursor = datetime.now(timezone.utc).date()
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
