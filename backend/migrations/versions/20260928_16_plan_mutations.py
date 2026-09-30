"""Durable account-scoped Plan create receipts for Mac background sync."""
from alembic import op
import sqlalchemy as sa

revision = '20260928_16'
down_revision = '20260927_15'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('plan_mutations',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('owner_id', sa.String(), sa.ForeignKey('app_users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('fingerprint', sa.String(), nullable=False),
        sa.Column('response', sa.String(), nullable=False))
    op.create_index('ix_plan_mutations_owner_id', 'plan_mutations', ['owner_id'])
    if op.get_bind().dialect.name == 'postgresql':
        op.execute(sa.text('ALTER TABLE plan_mutations ENABLE ROW LEVEL SECURITY'))
        op.execute(sa.text('REVOKE ALL ON TABLE plan_mutations FROM PUBLIC'))
        for role in ('anon', 'authenticated'):
            if op.get_bind().scalar(sa.text('SELECT 1 FROM pg_roles WHERE rolname=:role'), {'role': role}):
                op.execute(sa.text(f'REVOKE ALL ON TABLE plan_mutations FROM "{role}"'))
        # Existing installations already have the server role. Fresh installs
        # receive the same grant/policy from deploy/database-role.sql afterward.
        if op.get_bind().scalar(sa.text("SELECT 1 FROM pg_roles WHERE rolname='flowlist_api'")):
            op.execute(sa.text('GRANT SELECT, INSERT, UPDATE, DELETE ON plan_mutations TO flowlist_api'))
            op.execute(sa.text('CREATE POLICY flowlist_server_access ON plan_mutations TO flowlist_api USING (true) WITH CHECK (true)'))


def downgrade():
    op.drop_table('plan_mutations')
