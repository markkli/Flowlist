"""Mark one reusable guide example per account."""
from alembic import op
import sqlalchemy as sa
revision = '20260927_15'
down_revision = '20260921_14'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('goals', sa.Column('example_key', sa.String(), nullable=True))
    op.create_index('ix_goals_example_key', 'goals', ['example_key'], unique=True)

def downgrade():
    op.drop_index('ix_goals_example_key', table_name='goals')
    op.drop_column('goals', 'example_key')
