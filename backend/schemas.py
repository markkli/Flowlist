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


class TaskUpdate(BaseModel):
    title: str | None = None
    completed: bool | None = None


class Task(TaskCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    completed: bool
