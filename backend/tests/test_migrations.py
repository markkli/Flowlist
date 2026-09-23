"""Upgrade existing user data, including attribution snapshots, without loss."""
import os
import sqlite3
import subprocess
from pathlib import Path

import pytest


def test_migration_url_preserves_percent_escapes(tmp_path):
    root = Path(__file__).resolve().parents[1]
    # Exercise Alembic's real ConfigParser path with the same percent sequences
    # that occur in URL-encoded PostgreSQL passwords, without a live database.
    database = tmp_path / 'encoded%40%25.db'
    env = {**os.environ, 'DATABASE_URL': f'sqlite:///{database}', 'OPENAI_API_KEY': ''}
    subprocess.run(
        [str(root / '.venv/bin/alembic'), 'upgrade', 'head'],
        cwd=root, env=env, check=True, capture_output=True,
    )
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT version_num FROM alembic_version').fetchone() == ('20260921_14',)


def test_upgrade_and_downgrade_preserve_existing_records(tmp_path):
    root = Path(__file__).resolve().parents[1]
    database = tmp_path / 'migration.db'
    env = {**os.environ, 'DATABASE_URL': f'sqlite:///{database}', 'PYTHONDONTWRITEBYTECODE':'1', 'OPENAI_API_KEY':''}
    def migrate(*args):
        subprocess.run([str(root/'.venv/bin/alembic'), *args],cwd=root,env=env,check=True,capture_output=True)
    migrate('upgrade','20260917_08')
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO goals (id,title,goal_type,completed,position) VALUES (1,'Existing','project',0,1)")
        db.execute("INSERT INTO tasks (id,goal_id,depth,title,completed,position) VALUES (1,1,1,'Existing task',1,1)")
        db.execute("INSERT INTO focus_sessions (id,title,summary,planned_minutes,actual_minutes,completed) VALUES (1,'Original title','Keep this note',25,18,1)")
        db.execute("INSERT INTO focus_session_tasks (id,session_id,task_id,task_title,goal_title,completed) VALUES (1,1,1,'Existing task','Existing',1)")
    migrate('upgrade','head')
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT title,summary,actual_minutes,client_id,deleted_at FROM focus_sessions').fetchone() == ('Original title','Keep this note',18,None,None)
        assert db.execute('SELECT task_title FROM focus_session_tasks').fetchone()[0] == 'Existing task'
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    migrate('downgrade','20260917_08')
    migrate('upgrade','head')
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT summary FROM focus_sessions').fetchone()[0] == 'Keep this note'


def legacy_hierarchy_database(tmp_path):
    root = Path(__file__).resolve().parents[1]
    database = tmp_path / "hierarchy.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{database}", "PYTHONDONTWRITEBYTECODE": "1", "OPENAI_API_KEY": ""}

    def migrate(*args, check=True):
        return subprocess.run([str(root / ".venv/bin/alembic"), *args], cwd=root, env=env, check=check, capture_output=True, text=True)

    migrate("upgrade", "20260919_10")
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO goals (id,title,goal_type,completed,position) VALUES (1,'Existing project','project',0,1)")
        db.executemany(
            "INSERT INTO tasks (id,goal_id,parent_id,depth,title,completed,position) VALUES (?,1,?,?,?,?,?)",
            [
                (10, None, 1, "Root", 0, 7),
                (11, 10, 2, "First child", 0, 8),
                (12, 11, 3, "Later grandchild", 1, 5),
                (13, 11, 3, "Earlier grandchild", 0, 2),
                (14, 10, 2, "Second child", 1, 9),
                (15, 14, 3, "Last grandchild", 0, 4),
                (20, None, 1, "Unchanged root", 0, 9),
                (21, 20, 2, "Unchanged child", 0, 6),
            ],
        )
        db.execute("INSERT INTO focus_sessions (id,title,summary,planned_minutes,actual_minutes,completed) VALUES (1,'Preserved focus','Original reflection',25,18,1)")
        db.execute("INSERT INTO focus_session_tasks (id,session_id,task_id,task_title,goal_title,completed) VALUES (1,1,12,'Later grandchild','Existing project',1)")
        db.executemany("INSERT INTO focus_queue (task_id,position) VALUES (?,?)", [(13, 1), (21, 2)])
    return database, migrate


def test_two_level_migration_preserves_ids_preorder_completion_history_and_queue(tmp_path):
    database, migrate = legacy_hierarchy_database(tmp_path)
    with sqlite3.connect(database) as db:
        before = db.execute("SELECT id,goal_id,parent_id,depth,title,completed,position FROM tasks ORDER BY id").fetchall()
    migrate("upgrade", "head")
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT id,parent_id,depth,position FROM tasks ORDER BY id").fetchall() == [
            (10, None, 1, 7), (11, 10, 2, 1), (12, 10, 2, 3), (13, 10, 2, 2),
            (14, 10, 2, 4), (15, 10, 2, 5), (20, None, 1, 9), (21, 20, 2, 6),
        ]
        assert db.execute("SELECT id,goal_id,title,completed FROM tasks ORDER BY id").fetchall() == [
            (row[0], row[1], row[4], row[5]) for row in before
        ]
        assert db.execute("SELECT task_id,position FROM focus_queue ORDER BY position").fetchall() == [(13, 1), (21, 2)]
        assert db.execute("SELECT task_id,task_title,completed FROM focus_session_tasks").fetchone() == (12, "Later grandchild", 1)
        assert db.execute("SELECT title,summary FROM focus_sessions").fetchone() == ("Preserved focus", "Original reflection")
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        # Non-structural work remains safe during rollback, without overwriting
        # a user's title edits or completion since the migration.
        db.execute("UPDATE tasks SET title='Edited later',completed=0 WHERE id=12")
    migrate("downgrade", "20260919_10")
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT id,goal_id,parent_id,depth,position FROM tasks ORDER BY id").fetchall() == [
            (row[0], row[1], row[2], row[3], row[6]) for row in before
        ]
        assert db.execute("SELECT title,completed FROM tasks WHERE id=12").fetchone() == ("Edited later", 0)
        assert db.execute("SELECT task_id FROM focus_session_tasks").fetchone() == (12,)
        assert db.execute("SELECT task_id,position FROM focus_queue ORDER BY position").fetchall() == [(13, 1), (21, 2)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    migrate("upgrade", "head")


@pytest.mark.parametrize("change", ["reorder", "add", "delete"])
def test_two_level_downgrade_refuses_structural_changes_without_mutating_data(tmp_path, change):
    database, migrate = legacy_hierarchy_database(tmp_path)
    migrate("upgrade", "head")
    with sqlite3.connect(database) as db:
        db.execute("PRAGMA foreign_keys=ON")
        if change == "reorder":
            db.execute("UPDATE tasks SET position=100 WHERE id=12")
        elif change == "add":
            db.execute("INSERT INTO tasks (id,goal_id,parent_id,depth,title,completed,position) VALUES (22,1,10,2,'New work',0,6)")
        else:
            db.execute("DELETE FROM tasks WHERE id=13")
        before = db.execute("SELECT * FROM tasks ORDER BY id").fetchall()
    result = migrate("downgrade", "20260919_10", check=False)
    assert result.returncode != 0
    assert "Cannot safely restore the old task hierarchy after structural edits" in result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT * FROM tasks ORDER BY id").fetchall() == before
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == ("20260919_11",)
        assert db.execute("SELECT COUNT(*) FROM task_hierarchy_migration").fetchone() == (6,)


def test_two_level_upgrade_refuses_corrupt_parent_links_before_changing_data(tmp_path):
    database, migrate = legacy_hierarchy_database(tmp_path)
    with sqlite3.connect(database) as db:
        db.execute("UPDATE tasks SET parent_id=13 WHERE id=10")
        before = db.execute("SELECT * FROM tasks ORDER BY id").fetchall()
    result = migrate("upgrade", "head", check=False)
    assert result.returncode != 0
    assert "Task hierarchy contains a cycle" in result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT * FROM tasks ORDER BY id").fetchall() == before
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == ("20260919_10",)
        assert db.execute("SELECT name FROM sqlite_master WHERE name='task_hierarchy_migration'").fetchall() == []


def test_focus_block_migration_keeps_legacy_dates_unknown_and_protects_new_intervals(tmp_path):
    database, migrate = legacy_hierarchy_database(tmp_path)
    migrate('upgrade','head')
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT started_at,ended_at,revision FROM focus_sessions').fetchone() == (None,None,0)
        assert db.execute('SELECT COUNT(*) FROM focus_blocks').fetchone() == (0,)
        db.execute("UPDATE focus_sessions SET started_at='2026-09-19 10:00:00',ended_at='2026-09-19 10:18:00' WHERE id=1")
        db.execute("INSERT INTO focus_blocks (session_id,started_at,ended_at) VALUES (1,'2026-09-19 10:00:00','2026-09-19 10:18:00')")
    result=migrate('downgrade','20260919_11',check=False)
    assert result.returncode != 0 and 'Cannot discard recorded focus times' in result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT version_num FROM alembic_version').fetchone() == ('20260919_12',)
        assert db.execute('SELECT COUNT(*) FROM focus_blocks').fetchone() == (1,)
        assert db.execute('SELECT summary FROM focus_sessions').fetchone() == ('Original reflection',)


def test_learning_merge_preserves_identity_and_can_restore_original_types(tmp_path):
    database, migrate = legacy_hierarchy_database(tmp_path)
    migrate('upgrade','20260919_12')
    with sqlite3.connect(database) as db:
        db.execute("UPDATE goals SET goal_type='learning' WHERE id=1")
        tasks = db.execute('SELECT * FROM tasks ORDER BY id').fetchall()
        history = db.execute('SELECT * FROM focus_session_tasks ORDER BY id').fetchall()
    migrate('upgrade','head')
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT goal_type FROM goals WHERE id=1').fetchone() == ('project',)
        assert db.execute('SELECT * FROM tasks ORDER BY id').fetchall() == tasks
        assert db.execute('SELECT * FROM focus_session_tasks ORDER BY id').fetchall() == history
        db.execute("UPDATE goals SET title='Edited name' WHERE id=1")
    migrate('downgrade','20260919_12')
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT goal_type,title FROM goals WHERE id=1').fetchone() == ('learning','Edited name')
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
