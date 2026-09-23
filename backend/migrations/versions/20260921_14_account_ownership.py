"""Add private accounts without assigning existing local records to a visitor."""
from alembic import op
import sqlalchemy as sa
revision = '20260921_14'
down_revision = '20260920_13'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('app_users', sa.Column('id', sa.String(), primary_key=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(), nullable=True))
    # Avoid rebuilding SQLite parent tables: FK cascades would destroy children.
    for table in ('goals', 'focus_sessions'):
        op.add_column(table, sa.Column('owner_id', sa.String(), nullable=True))
        op.create_index(f'ix_{table}_owner_id', table, ['owner_id'])
    if op.get_bind().dialect.name == 'postgresql':
        for table in ('goals','focus_sessions'):
            op.create_foreign_key(f'fk_{table}_owner',table,'app_users',['owner_id'],['id'],ondelete='CASCADE')
        # Browser auth must not grant direct Data API access to application tables.
        for table in ('app_users','goals','tasks','focus_sessions','focus_session_tasks','focus_queue','focus_blocks','learning_project_migration','task_hierarchy_migration'):
            op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
            for role in ('anon','authenticated'):
                exists = op.get_bind().scalar(sa.text('SELECT 1 FROM pg_roles WHERE rolname=:role'), {'role':role})
                if exists: op.execute(sa.text(f'REVOKE ALL ON TABLE "{table}" FROM "{role}"'))


def downgrade():
    db = op.get_bind()
    if db.scalar(sa.text('SELECT COUNT(*) FROM app_users')):
        raise RuntimeError('Cannot remove ownership while accounts exist')
    for table in ('goals','focus_sessions'):
        if db.dialect.name == 'postgresql': op.drop_constraint(f'fk_{table}_owner', table, type_='foreignkey')
        op.drop_index(f'ix_{table}_owner_id', table_name=table)
        op.drop_column(table,'owner_id')
    op.drop_table('app_users')
