"""Remove task priority from the roadmap model.

Revision ID: 20260913_04
Revises: 20260912_03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260913_04"
down_revision: str | None = "20260912_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("priority")


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(
            sa.Column("priority", sa.Integer(), nullable=False, server_default="2")
        )
