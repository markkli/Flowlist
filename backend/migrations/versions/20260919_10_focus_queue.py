"""Add a persistent focus shortlist without changing existing Plan data."""
from alembic import op
import sqlalchemy as sa

revision = "20260919_10"
down_revision = "20260919_09"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "focus_queue",
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id"),
    )


def downgrade():
    op.drop_table("focus_queue")
