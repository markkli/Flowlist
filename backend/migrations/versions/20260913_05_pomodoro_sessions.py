"""Make Pomodoro sessions independent from task estimates.

Revision ID: 20260913_05
Revises: 20260913_04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260913_05"
down_revision: str | None = "20260913_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _replace_session_task_foreign_key(*, nullable: bool, ondelete: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            "focus_sessions",
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.drop_constraint(
                "fk_focus_sessions_task_id_tasks", type_="foreignkey"
            )
            batch_op.alter_column(
                "task_id", existing_type=sa.Integer(), nullable=nullable
            )
            batch_op.create_foreign_key(
                "fk_focus_sessions_task_id_tasks",
                "tasks",
                ["task_id"],
                ["id"],
                ondelete=ondelete,
            )
        return

    op.drop_constraint(
        "focus_sessions_task_id_fkey", "focus_sessions", type_="foreignkey"
    )
    op.alter_column(
        "focus_sessions", "task_id", existing_type=sa.Integer(), nullable=nullable
    )
    op.create_foreign_key(
        "focus_sessions_task_id_fkey",
        "focus_sessions",
        "tasks",
        ["task_id"],
        ["id"],
        ondelete=ondelete,
    )


def upgrade() -> None:
    _replace_session_task_foreign_key(nullable=True, ondelete="SET NULL")
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("estimated_minutes")


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(
            sa.Column(
                "estimated_minutes",
                sa.Integer(),
                nullable=False,
                server_default="25",
            )
        )
    op.execute(sa.text("DELETE FROM focus_sessions WHERE task_id IS NULL"))
    _replace_session_task_foreign_key(nullable=False, ondelete="CASCADE")
