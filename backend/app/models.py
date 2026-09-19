from datetime import datetime

from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GoalModel(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    description: Mapped[str | None]
    goal_type: Mapped[str] = mapped_column(default="project", server_default="project")
    completed: Mapped[bool] = mapped_column(default=False)
    position: Mapped[int] = mapped_column(default=0)

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
    position: Mapped[int] = mapped_column(default=0)

    goal: Mapped["GoalModel"] = relationship(back_populates="tasks")
    session_attributions: Mapped[list["FocusSessionTaskModel"]] = relationship(
        back_populates="task", passive_deletes=True
    )


class FocusQueueModel(Base):
    """A persistent, user-ordered shortlist independent of the Plan order."""

    __tablename__ = "focus_queue"

    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(default=0)


class FocusSessionModel(Base):
    __tablename__ = "focus_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str | None] = mapped_column(nullable=True, unique=True)
    deleted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    title: Mapped[str | None] = mapped_column(nullable=True)
    summary: Mapped[str | None] = mapped_column(nullable=True)
    planned_minutes: Mapped[int]
    actual_minutes: Mapped[int]
    completed: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    attributions: Mapped[list["FocusSessionTaskModel"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="FocusSessionTaskModel.id",
    )

    @property
    def task_title(self) -> str:
        if self.title:
            return self.title
        if not self.attributions:
            return "General focus"
        titles = [attribution.task_title for attribution in self.attributions]
        if len(titles) == 1:
            return titles[0]
        goal_titles = {
            attribution.goal_title
            for attribution in self.attributions
            if attribution.goal_title
        }
        if len(goal_titles) == 1:
            return f"{next(iter(goal_titles))} focus"
        return "Focused work"


class FocusSessionTaskModel(Base):
    __tablename__ = "focus_session_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("focus_sessions.id", ondelete="CASCADE")
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    task_title: Mapped[str]
    goal_title: Mapped[str | None]
    completed: Mapped[bool] = mapped_column(default=False)

    session: Mapped["FocusSessionModel"] = relationship(back_populates="attributions")
    task: Mapped["TaskModel | None"] = relationship(
        back_populates="session_attributions"
    )
