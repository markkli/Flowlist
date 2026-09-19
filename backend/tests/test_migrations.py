"""Upgrade existing user data, including attribution snapshots, without loss."""
import os
import sqlite3
import subprocess
from pathlib import Path


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
