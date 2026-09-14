from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

GoalType = Literal["project", "learning"]


class TitledPayload(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Title must not be blank")
        return title


class OptionalTitleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return value
        title = value.strip()
        if not title:
            raise ValueError("Title must not be blank")
        return title


class GoalCreate(TitledPayload):
    description: str | None = None
    goal_type: GoalType = "project"


class GoalUpdate(OptionalTitleUpdate):
    description: str | None = None
    goal_type: GoalType | None = None


class Goal(GoalCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int


class TaskCreate(TitledPayload):
    pass


class TaskUpdate(OptionalTitleUpdate):
    completed: bool | None = None


class Task(TaskCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    parent_id: int | None
    depth: int
    completed: bool


class SuggestedSubtask(TitledPayload):
    pass


class ClarificationQuestion(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    question: str = Field(min_length=1, max_length=500)


class LearningAnswer(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    answer: str = Field(min_length=1, max_length=2000)

    @field_validator("answer")
    @classmethod
    def normalize_answer(cls, value: str) -> str:
        answer = value.strip()
        if not answer:
            raise ValueError("Answer must not be blank")
        return answer


class LearningBreakdownRequest(BaseModel):
    answers: list[LearningAnswer] = Field(min_length=1, max_length=6)


class FocusSessionCreate(BaseModel):
    task_id: int | None = None
    planned_minutes: int = Field(ge=1, le=480)
    actual_minutes: int = Field(ge=0, le=480)
    completed: bool
    complete_task: bool = False


class FocusSession(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int | None
    task_title: str
    planned_minutes: int
    actual_minutes: int
    completed: bool
    created_at: datetime


class FocusTaskOption(BaseModel):
    id: int
    title: str
    goal_id: int
    goal_title: str
    last_focused_at: datetime | None = None


class Stats(BaseModel):
    current_streak: int
    total_sessions: int
    total_minutes: int


class NextFocus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task: Task
    goal: Goal
