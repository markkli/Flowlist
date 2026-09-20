"""Flatten deeper task levels into ordered subtasks, preserving record identity.

The migration journal makes rollback safe for unchanged hierarchy structure.
Titles, completion, sessions, and queue membership are never rewritten.
"""
from collections import defaultdict

from alembic import op
import sqlalchemy as sa

revision = "20260919_11"
down_revision = "20260919_10"
branch_labels = None
depends_on = None

JOURNAL = "task_hierarchy_migration"
tasks = sa.table(
    "tasks", sa.column("id", sa.Integer()), sa.column("goal_id", sa.Integer()),
    sa.column("parent_id", sa.Integer()), sa.column("depth", sa.Integer()),
    sa.column("position", sa.Integer()),
)


def tree_roots(rows):
    """Reject corrupt links before touching data; never guess a broken tree."""
    by_id = {row["id"]: row for row in rows}
    roots = {}
    for row in rows:
        current = row
        seen = set()
        while current["parent_id"] is not None:
            if current["id"] in seen:
                raise RuntimeError("Task hierarchy contains a cycle; repair it before migrating")
            seen.add(current["id"])
            parent = by_id.get(current["parent_id"])
            if parent is None or parent["goal_id"] != row["goal_id"]:
                raise RuntimeError("Task hierarchy contains a missing or cross-project parent; repair it before migrating")
            current = parent
        roots[row["id"]] = current["id"]
    return roots


def upgrade():
    bind = op.get_bind()
    rows = [dict(row) for row in bind.execute(sa.select(tasks)).mappings()]
    tree_roots(rows)
    children = defaultdict(list)
    for row in rows:
        children[row["parent_id"]].append(row)
    for siblings in children.values():
        siblings.sort(key=lambda row: (row["position"], row["id"]))

    standalone_ids = set(bind.execute(sa.text("SELECT id FROM goals WHERE goal_type = 'standalone'")).scalars())
    if any(row["goal_id"] in standalone_ids and row["parent_id"] is not None for row in rows):
        raise RuntimeError("The Tasks list contains nested legacy items; repair them before migrating")

    journal_rows = []
    for root in children[None]:
        preorder = []
        pending = [root]
        while pending:
            current = pending.pop()
            preorder.append(current)
            pending.extend(reversed(children[current["id"]]))
        if not any(
            row["depth"] != (1 if row["id"] == root["id"] else 2)
            or (row["id"] != root["id"] and row["parent_id"] != root["id"])
            for row in preorder
        ):
            continue
        for index, row in enumerate(preorder):
            journal_rows.append({
                "task_id": row["id"], "goal_id": row["goal_id"], "root_id": root["id"],
                "old_parent_id": row["parent_id"], "old_depth": row["depth"], "old_position": row["position"],
                "new_parent_id": root["id"] if index else None,
                "new_depth": 2 if index else 1,
                "new_position": index if index else row["position"],
            })

    journal = op.create_table(
        JOURNAL,
        sa.Column("task_id", sa.Integer(), primary_key=True),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("root_id", sa.Integer(), nullable=False),
        sa.Column("old_parent_id", sa.Integer(), nullable=True),
        sa.Column("old_depth", sa.Integer(), nullable=False),
        sa.Column("old_position", sa.Integer(), nullable=False),
        sa.Column("new_parent_id", sa.Integer(), nullable=True),
        sa.Column("new_depth", sa.Integer(), nullable=False),
        sa.Column("new_position", sa.Integer(), nullable=False),
    )
    if journal_rows:
        bind.execute(journal.insert(), journal_rows)
        for row in journal_rows:
            bind.execute(tasks.update().where(tasks.c.id == row["task_id"]).values(
                parent_id=row["new_parent_id"], depth=row["new_depth"], position=row["new_position"],
            ))


def downgrade():
    bind = op.get_bind()
    journal = sa.Table(JOURNAL, sa.MetaData(), autoload_with=bind)
    saved = list(bind.execute(sa.select(journal)).mappings())
    current_rows = list(bind.execute(sa.select(tasks)).mappings())
    by_id = {row["id"]: row for row in current_rows}
    roots = tree_roots(current_rows)
    affected_roots = {row["root_id"] for row in saved}
    saved_ids = {row["task_id"] for row in saved}
    # Validate everything before restoring any row. A downgrade must not guess
    # where newly added, deleted, moved, or reordered work belongs.
    changed = any(
        row["id"] not in saved_ids and roots[row["id"]] in affected_roots
        for row in current_rows
    )
    for row in saved:
        current = by_id.get(row["task_id"])
        if current is None or current["goal_id"] != row["goal_id"] or any(
            current[field] != row[f"new_{field}"] for field in ("parent_id", "depth", "position")
        ):
            changed = True
    if changed:
        raise RuntimeError(
            "Cannot safely restore the old task hierarchy after structural edits. "
            "Keep this migration, or restore the pre-migration database backup. No task data was changed."
        )
    for row in saved:
        bind.execute(tasks.update().where(tasks.c.id == row["task_id"]).values(
            parent_id=row["old_parent_id"], depth=row["old_depth"], position=row["old_position"],
        ))
    op.drop_table(JOURNAL)
