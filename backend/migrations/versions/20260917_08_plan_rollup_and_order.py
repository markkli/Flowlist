"""Add hierarchical completion and persistent plan ordering.

Revision ID: 20260917_08
Revises: 20260915_07
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260917_08"
down_revision: str | None = "20260915_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "goals",
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "goals",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "tasks",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(sa.text("UPDATE goals SET position = id"))
    op.execute(sa.text("UPDATE tasks SET position = id"))


def downgrade() -> None:
    op.drop_column("tasks", "position")
    op.drop_column("goals", "position")
    op.drop_column("goals", "completed")
