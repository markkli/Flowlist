from datetime import datetime

from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class GoalModel(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    description: Mapped[str | None]

    tasks: Mapped[list["TaskModel"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan"
    )


class TaskModel(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    depth: Mapped[int] = mapped_column(default=1)
    title: Mapped[str]
    completed: Mapped[bool] = mapped_column(default=False)
    estimated_minutes: Mapped[int] = mapped_column(default=25)
    priority: Mapped[int] = mapped_column(default=2)

    goal: Mapped["GoalModel"] = relationship(back_populates="tasks")
    sessions: Mapped[list["FocusSessionModel"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class FocusSessionModel(Base):
    __tablename__ = "focus_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    planned_minutes: Mapped[int]
    actual_minutes: Mapped[int]
    completed: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    task: Mapped["TaskModel"] = relationship(back_populates="sessions")

    @property
    def task_title(self) -> str:
        return self.task.title
