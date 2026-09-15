"""Allow one focus session to be attributed to multiple tasks.

Revision ID: 20260913_06
Revises: 20260913_05
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260913_06"
down_revision: str | None = "20260913_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def upgrade() -> None:
    op.create_table(
        "focus_session_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("task_title", sa.String(), nullable=False),
        sa.Column("goal_title", sa.String(), nullable=True),
        sa.Column(
            "completed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["focus_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "task_id"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO focus_session_tasks
                (session_id, task_id, task_title, goal_title, completed)
            SELECT focus_sessions.id, tasks.id, tasks.title, goals.title, FALSE
            FROM focus_sessions
            JOIN tasks ON tasks.id = focus_sessions.task_id
            JOIN goals ON goals.id = tasks.goal_id
            WHERE focus_sessions.task_id IS NOT NULL
            """
        )
    )
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            "focus_sessions", naming_convention=NAMING_CONVENTION
        ) as batch_op:
            batch_op.drop_constraint(
                "fk_focus_sessions_task_id_tasks", type_="foreignkey"
            )
            batch_op.drop_column("task_id")
    else:
        op.drop_constraint(
            "focus_sessions_task_id_fkey", "focus_sessions", type_="foreignkey"
        )
        op.drop_column("focus_sessions", "task_id")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            "focus_sessions", naming_convention=NAMING_CONVENTION
        ) as batch_op:
            batch_op.add_column(sa.Column("task_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_focus_sessions_task_id_tasks",
                "tasks",
                ["task_id"],
                ["id"],
                ondelete="SET NULL",
            )
    else:
        op.add_column(
            "focus_sessions", sa.Column("task_id", sa.Integer(), nullable=True)
        )
        op.create_foreign_key(
            "focus_sessions_task_id_fkey",
            "focus_sessions",
            "tasks",
            ["task_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.execute(
        sa.text(
            """
            UPDATE focus_sessions
            SET task_id = (
                SELECT focus_session_tasks.task_id
                FROM focus_session_tasks
                WHERE focus_session_tasks.session_id = focus_sessions.id
                  AND focus_session_tasks.task_id IS NOT NULL
                ORDER BY focus_session_tasks.id
                LIMIT 1
            )
            """
        )
    )
    op.drop_table("focus_session_tasks")
