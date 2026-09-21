"""Merge learning into projects without changing task or history identity."""
from alembic import op
import sqlalchemy as sa

revision = '20260920_13'
down_revision = '20260919_12'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('learning_project_migration',
        sa.Column('goal_id', sa.Integer(), sa.ForeignKey('goals.id', ondelete='CASCADE'), primary_key=True))
    db = op.get_bind()
    db.execute(sa.text("INSERT INTO learning_project_migration (goal_id) SELECT id FROM goals WHERE goal_type='learning'"))
    db.execute(sa.text("UPDATE goals SET goal_type='project' WHERE goal_type='learning'"))


def downgrade():
    op.get_bind().execute(sa.text("UPDATE goals SET goal_type='learning' WHERE goal_type='project' AND id IN (SELECT goal_id FROM learning_project_migration)"))
    op.drop_table('learning_project_migration')
