from sqlalchemy import ForeignKey
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
    title: Mapped[str]
    completed: Mapped[bool] = mapped_column(default=False)

    goal: Mapped["GoalModel"] = relationship(back_populates="tasks")
