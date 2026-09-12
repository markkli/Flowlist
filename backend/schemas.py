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
    estimated_minutes: int = Field(default=25, ge=5, le=480)
    priority: int = Field(default=2, ge=1, le=3)


class TaskUpdate(OptionalTitleUpdate):
    completed: bool | None = None
    estimated_minutes: int | None = Field(default=None, ge=5, le=480)
    priority: int | None = Field(default=None, ge=1, le=3)


class Task(TaskCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    parent_id: int | None
    depth: int
    completed: bool


class SuggestedSubtask(TitledPayload):
    estimated_minutes: int = Field(ge=5, le=480)


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
    actual_minutes: int = Field(ge=0, le=480)
    completed: bool


class FocusSession(FocusSessionCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    task_title: str
    planned_minutes: int
    created_at: datetime


class Stats(BaseModel):
    current_streak: int
    total_sessions: int
    total_minutes: int


class NextFocus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task: Task
    goal: Goal
