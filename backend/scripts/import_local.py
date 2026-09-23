"""Explicit one-time local-data import into an existing, empty beta account.

Default is dry run. Source SQLite is opened read-only. Destination writes are one
transaction; existing IDs are remapped, never adopted as public account identity.
"""
import argparse
import hashlib
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID
from sqlalchemy import select

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.database import SessionLocal
from app.models import UserModel, GoalModel, TaskModel, FocusSessionModel, FocusSessionTaskModel, FocusBlockModel, FocusQueueModel


def import_data(source: Path, subject: str, apply=False):
    subject=str(UUID(subject))
    with sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True) as src:
        src.row_factory=sqlite3.Row
        tables={row[0] for row in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        data={name:[dict(row) for row in src.execute(f'SELECT * FROM {name}')] if name in tables else []
              for name in ['goals','tasks','focus_sessions','focus_session_tasks','focus_blocks','focus_queue']}
    if any(row.get('owner_id') for name in ('goals','focus_sessions') for row in data[name]):
        raise ValueError('Source must contain only unclaimed local data.')
    counts={name:len(rows) for name,rows in data.items()}
    with SessionLocal() as db:
        user=db.scalar(select(UserModel).where(UserModel.id==subject).with_for_update())
        if not user or user.deleted_at: raise ValueError('Sign in to the destination account first.')
        if db.scalar(select(GoalModel.id).where(GoalModel.owner_id==subject).limit(1)) or db.scalar(select(FocusSessionModel.id).where(FocusSessionModel.owner_id==subject).limit(1)):
            raise ValueError('Destination account must be empty; import refuses duplicates or merges.')
        if not apply: return counts
        def values(row,names): return {name:row[name] for name in names if name in row}
        def dates(row,names):
            result=values(row,names)
            return {key:datetime.fromisoformat(value) if isinstance(value,str) else value for key,value in result.items()}
        goals,tasks,sessions={},{},{}
        for row in data['goals']:
            goal=GoalModel(owner_id=subject,**values(row,['title','description','goal_type','completed','position']))
            if goal.goal_type=='learning': goal.goal_type='project'
            db.add(goal);db.flush();goals[row['id']]=goal.id
        pending=list(data['tasks'])
        while pending:
            remaining=[]
            for row in pending:
                if row.get('parent_id') is not None and row['parent_id'] not in tasks: remaining.append(row);continue
                task=TaskModel(goal_id=goals[row['goal_id']],parent_id=tasks.get(row.get('parent_id')),
                    **values(row,['depth','title','completed','position']))
                if task.depth>2: raise ValueError('Upgrade the local database to the current two-level schema before importing.')
                db.add(task);db.flush();tasks[row['id']]=task.id
            if len(remaining)==len(pending): raise ValueError('Source has invalid task parents.')
            pending=remaining
        for row in data['focus_sessions']:
            client_id=hashlib.sha256(f"{subject}:{row['client_id']}".encode()).hexdigest() if row.get('client_id') else None
            record=FocusSessionModel(owner_id=subject,client_id=client_id,
                **values(row,['title','summary','planned_minutes','actual_minutes','completed','revision']),
                **dates(row,['created_at','deleted_at','started_at','ended_at']))
            db.add(record);db.flush();sessions[row['id']]=record.id
        for row in data['focus_session_tasks']:
            db.add(FocusSessionTaskModel(session_id=sessions[row['session_id']],task_id=tasks.get(row.get('task_id')),
                **values(row,['task_title','goal_title','completed'])))
        for row in data['focus_blocks']:
            db.add(FocusBlockModel(session_id=sessions[row['session_id']],**dates(row,['started_at','ended_at'])))
        for row in data['focus_queue']:
            db.add(FocusQueueModel(task_id=tasks[row['task_id']],position=row['position']))
        db.commit()
    return counts


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--user',required=True,help='Exact Supabase user UUID of the intended owner')
    parser.add_argument('--apply',action='store_true',help='Commit the import after reviewing the dry run')
    args=parser.parse_args()
    counts=import_data(args.source,args.user,args.apply)
    print(('Imported' if args.apply else 'Dry run; no changes'),counts)
