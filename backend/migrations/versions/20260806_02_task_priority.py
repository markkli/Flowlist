"""Add explicit task priority.

Revision ID: 20260806_02
Revises: 20260804_01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260806_02"
down_revision: str | None = "20260804_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("priority", sa.Integer(), nullable=False, server_default="2"),
    )


def downgrade() -> None:
    op.drop_column("tasks", "priority")
