"""Add generated titles and optional notes to focus sessions.

Revision ID: 20260915_07
Revises: 20260913_06
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260915_07"
down_revision: str | None = "20260913_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("focus_sessions", sa.Column("title", sa.String(), nullable=True))
    op.add_column("focus_sessions", sa.Column("summary", sa.Text(), nullable=True))
    bind = op.get_bind()
    session_ids = list(bind.execute(sa.text("SELECT id FROM focus_sessions")).scalars())
    for session_id in session_ids:
        attributions = bind.execute(
            sa.text(
                """
                SELECT task_title, goal_title
                FROM focus_session_tasks
                WHERE session_id = :session_id
                ORDER BY id
                """
            ),
            {"session_id": session_id},
        ).all()
        if not attributions:
            title = "General focus"
        elif len(attributions) == 1:
            title = attributions[0].task_title
        else:
            goal_titles = {row.goal_title for row in attributions if row.goal_title}
            title = (
                f"{next(iter(goal_titles))} focus"
                if len(goal_titles) == 1
                else "Focused work"
            )
        bind.execute(
            sa.text("UPDATE focus_sessions SET title = :title WHERE id = :session_id"),
            {"title": title, "session_id": session_id},
        )


def downgrade() -> None:
    op.drop_column("focus_sessions", "summary")
    op.drop_column("focus_sessions", "title")
