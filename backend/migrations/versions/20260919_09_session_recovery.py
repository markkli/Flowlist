"""Add retry-safe ritual IDs and recoverable history deletion."""
from alembic import op
import sqlalchemy as sa

revision = "20260919_09"
down_revision = "20260917_08"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("focus_sessions") as batch:
        batch.add_column(sa.Column("client_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
        batch.create_unique_constraint("uq_focus_sessions_client_id", ["client_id"])


def downgrade():
    with op.batch_alter_table("focus_sessions") as batch:
        batch.drop_constraint("uq_focus_sessions_client_id", type_="unique")
        batch.drop_column("deleted_at")
        batch.drop_column("client_id")
