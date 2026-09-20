"""Record actual focus intervals; legacy sessions deliberately remain untimed."""
from alembic import op
import sqlalchemy as sa

revision = "20260919_12"
down_revision = "20260919_11"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("focus_sessions", sa.Column("started_at", sa.DateTime(), nullable=True))
    op.add_column("focus_sessions", sa.Column("ended_at", sa.DateTime(), nullable=True))
    op.add_column("focus_sessions", sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
    op.create_table("focus_blocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("focus_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=False),
    )
    for column in ("session_id", "started_at", "ended_at"):
        op.create_index(f"ix_focus_blocks_{column}", "focus_blocks", [column])


def downgrade():
    if op.get_bind().execute(sa.text("SELECT COUNT(*) FROM focus_sessions WHERE started_at IS NOT NULL")).scalar():
        raise RuntimeError("Cannot discard recorded focus times. Export or back up this database before choosing an older version.")
    op.drop_table("focus_blocks")
    for column in ("revision", "ended_at", "started_at"):
        op.drop_column("focus_sessions", column)
