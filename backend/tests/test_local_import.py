import hashlib
import sqlite3
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from test_ritual_flow import app, clean_test_database
from app.database import Base, engine, SessionLocal
from app.models import UserModel, GoalModel, TaskModel, FocusSessionModel, FocusQueueModel
from scripts.import_local import import_data


def source_copy(tmp_path):
    client=TestClient(app)
    goal=client.post('/goals',json={'title':'Existing local project'}).json()
    task=client.post(f"/goals/{goal['id']}/tasks",json={'title':'Keep my work'}).json()
    client.put('/queue',json={'ordered_ids':[task['id']]})
    response=client.post('/sessions',json={'client_id':'local-ritual','planned_minutes':1,'actual_minutes':1,'completed':True,
        'summary':'Original private reflection','started_at':'2026-09-19T10:00:00Z','ended_at':'2026-09-19T10:01:00Z',
        'blocks':[{'started_at':'2026-09-19T10:00:00Z','ended_at':'2026-09-19T10:01:00Z'}],
        'tasks':[{'task_id':task['id'],'completed':True}]})
    assert response.status_code==200,response.text
    source=tmp_path/'source.sqlite3'
    with sqlite3.connect(engine.url.database) as original,sqlite3.connect(source) as copy: original.backup(copy)
    Base.metadata.drop_all(engine);Base.metadata.create_all(engine)
    subject=str(uuid4())
    with SessionLocal() as db: db.add(UserModel(id=subject));db.commit()
    return source,subject


def test_local_import_is_explicit_atomic_and_preserves_records_and_source(tmp_path):
    source,subject=source_copy(tmp_path)
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    counts=import_data(source,subject)
    assert counts['focus_blocks']==counts['focus_sessions']==counts['focus_session_tasks']==1
    with SessionLocal() as db: assert db.query(GoalModel).count()==0
    assert import_data(source,subject,True)==counts
    with SessionLocal() as db:
        assert db.query(GoalModel).one().owner_id==subject
        record=db.query(FocusSessionModel).one()
        assert record.owner_id==subject and record.summary=='Original private reflection'
        assert record.blocks[0].started_at.isoformat()=='2026-09-19T10:00:00'
        task=db.query(TaskModel).one()
        assert task.completed and record.attributions[0].task_id==task.id
        assert db.query(FocusQueueModel).one().task_id==task.id
    with pytest.raises(ValueError,match='empty'): import_data(source,subject,True)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==digest


def test_invalid_import_rolls_back_and_requires_existing_owner(tmp_path):
    source,subject=source_copy(tmp_path)
    with pytest.raises(ValueError,match='Sign in'): import_data(source,str(uuid4()),True)
    with sqlite3.connect(source) as db: db.execute('UPDATE tasks SET parent_id=999999')
    with pytest.raises(ValueError,match='parents'): import_data(source,subject,True)
    with SessionLocal() as db: assert db.query(GoalModel).count()==db.query(TaskModel).count()==0
