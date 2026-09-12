"""Add project or learning goal type.

Revision ID: 20260912_03
Revises: 20260806_02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260912_03"
down_revision: str | None = "20260806_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("goals", sa.Column("goal_type", sa.String(), nullable=False, server_default="project"))


def downgrade() -> None:
    op.drop_column("goals", "goal_type")
