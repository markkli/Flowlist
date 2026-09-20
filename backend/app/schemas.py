from datetime import datetime, timezone, timedelta

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

GoalType = Literal["project", "learning", "standalone"]


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
    @model_validator(mode="before")
    @classmethod
    def reject_null_required_fields(cls, value):
        if isinstance(value, dict):
            for key in ("title", "completed", "goal_type"):
                if key in value and value[key] is None:
                    raise ValueError(f"{key} must not be null")
        return value

    title: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("Title must not be null")
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
    completed: bool | None = None


class Goal(GoalCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    completed: bool
    position: int


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
    position: int


class ReorderPayload(BaseModel):
    ordered_ids: list[int] = Field(min_length=1)

    @field_validator("ordered_ids")
    @classmethod
    def reject_duplicate_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("Ordered IDs must be unique")
        return value


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


def utc_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("Use an ISO timestamp with a timezone offset")
    return value.astimezone(timezone.utc).replace(tzinfo=None)


class FocusBlockCreate(BaseModel):
    started_at: datetime
    ended_at: datetime

    _timestamps = field_validator("started_at", "ended_at")(utc_timestamp)

    @model_validator(mode="after")
    def valid_interval(self):
        duration = (self.ended_at - self.started_at).total_seconds()
        if not 0 < duration <= 7200 or duration != int(duration):
            raise ValueError("Focus blocks must contain 1–7200 whole seconds")
        return self


class FocusBlock(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    started_at: datetime
    ended_at: datetime


class FocusSessionCreate(BaseModel):
    client_id: str | None = Field(default=None, min_length=1, max_length=64)
    planned_minutes: int = Field(ge=1, le=2147483647)
    actual_minutes: int = Field(ge=0, le=2147483647)
    completed: bool
    summary: str | None = Field(default=None, max_length=2000)
    tasks: list["FocusSessionTaskCreate"] = Field(default_factory=list, max_length=300)
    started_at: datetime | None = None
    ended_at: datetime | None = None
    blocks: list[FocusBlockCreate] | None = Field(default=None, max_length=2000)

    @field_validator("started_at", "ended_at")
    @classmethod
    def normalize_time(cls, value):
        return utc_timestamp(value) if value is not None else None

    @model_validator(mode="after")
    def validate_timing(self):
        if self.blocks is None:
            if self.started_at is not None or self.ended_at is not None:
                raise ValueError("Ritual times require focus blocks")
            return self
        if self.started_at is None or self.ended_at is None or self.ended_at < self.started_at:
            raise ValueError("Timed rituals require ordered start and end times")
        if self.ended_at > datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=5):
            raise ValueError("Ritual cannot end in the future; check the device clock")
        previous = self.started_at
        seconds = 0
        for block in self.blocks:
            if block.started_at < previous or block.ended_at > self.ended_at:
                raise ValueError("Focus blocks must be ordered, non-overlapping and within the ritual")
            seconds += int((block.ended_at - block.started_at).total_seconds())
            previous = block.ended_at
        if seconds // 60 != self.actual_minutes:
            raise ValueError("Focus block duration must match the ritual's focused minutes")
        return self

    @field_validator("summary")
    @classmethod
    def normalize_summary(cls, value: str | None) -> str | None:
        if value is None:
            return None
        summary = value.strip()
        return summary or None

    @field_validator("tasks")
    @classmethod
    def task_ids_must_be_unique(
        cls, value: list["FocusSessionTaskCreate"]
    ) -> list["FocusSessionTaskCreate"]:
        task_ids = [task.task_id for task in value]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("A task can only be attributed once per session")
        return value


class FocusSessionTaskCreate(BaseModel):
    task_id: int
    completed: bool = False


class FocusSessionTask(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int

    task_id: int | None
    task_title: str
    goal_title: str | None
    completed: bool


class FocusSession(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_title: str
    summary: str | None
    planned_minutes: int
    actual_minutes: int
    completed: bool
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    revision: int
    blocks: list[FocusBlock]
    attributions: list[FocusSessionTask]


class FocusTaskOption(BaseModel):
    id: int
    title: str
    goal_id: int
    goal_title: str
    goal_type: GoalType
    parent_id: int | None
    depth: int
    position: int
    ancestor_titles: list[str] = Field(default_factory=list)
    has_children: bool = False
    last_focused_at: datetime | None = None


class Stats(BaseModel):
    current_streak: int
    total_sessions: int
    total_minutes: int


class NextFocus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task: Task
    goal: Goal


class HistoryAttributionEdit(BaseModel):
    attribution_id: int | None = Field(default=None, ge=1)
    task_id: int | None = Field(default=None, ge=1)
    completed: bool = False

    @model_validator(mode="after")
    def one_reference(self):
        if (self.attribution_id is None) == (self.task_id is None):
            raise ValueError("Choose an existing attribution or a task")
        return self


class HistoryEdit(BaseModel):
    revision: int = Field(ge=0)
    summary: str | None = Field(max_length=2000)
    attributions: list[HistoryAttributionEdit] = Field(max_length=300)
