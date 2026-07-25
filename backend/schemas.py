from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GoalCreate(BaseModel):
    title: str
    description: str | None = None


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None


class Goal(GoalCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int


class TaskCreate(BaseModel):
    title: str
    estimated_minutes: int = 25


class TaskUpdate(BaseModel):
    title: str | None = None
    completed: bool | None = None
    estimated_minutes: int | None = None


class Task(TaskCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    completed: bool


class FocusSessionCreate(BaseModel):
    actual_minutes: int
    completed: bool


class FocusSession(FocusSessionCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    planned_minutes: int
    created_at: datetime
