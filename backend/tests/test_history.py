from test_ritual_flow import app, clean_test_database
from fastapi.testclient import TestClient
from app.database import SessionLocal
from app.models import FocusSessionModel
from datetime import datetime
import pytest


def timed_body(**changes):
    return {"client_id":"timed-one","planned_minutes":35,"actual_minutes":35,"completed":True,
        "started_at":"2026-09-18T23:50:00Z", "ended_at":"2026-09-19T00:30:00Z",
        "blocks":[{"started_at":"2026-09-18T23:50:00Z","ended_at":"2026-09-19T00:15:00Z"},
                  {"started_at":"2026-09-19T00:20:00Z","ended_at":"2026-09-19T00:30:00Z"}], **changes}


def test_delayed_save_keeps_focus_dates_and_idempotent_blocks():
    client=TestClient(app)
    first=client.post('/sessions',json=timed_body())
    assert first.status_code==200, first.text
    session=first.json()
    again=client.post('/sessions',json=timed_body()).json()
    assert again['id']==session['id'] and len(again['blocks'])==2
    with SessionLocal() as db:
        db.get(FocusSessionModel,session['id']).created_at=datetime(2026,9,25)
        db.commit()
    week=client.get('/history/week?start=2026-09-14&timezone=UTC').json()
    assert len(week['sessions'])==1
    assert [(day['date'],day['minutes']) for day in week['days'] if day['minutes']]==[('2026-09-18',10),('2026-09-19',25)]
    assert client.get('/history/week?start=2026-09-21&timezone=UTC').json()['sessions']==[]
    client.delete(f"/sessions/{session['id']}")
    assert client.get('/history/week?start=2026-09-14&timezone=UTC').json()['sessions']==[]
    client.post(f"/sessions/{session['id']}/restore")
    assert len(client.get('/history/week?start=2026-09-14&timezone=UTC').json()['sessions'])==1


@pytest.mark.parametrize('change',[
    {'actual_minutes':36},
    {'started_at':'2026-09-18T23:50:00'},
    {'ended_at':'2026-09-19T00:00:00Z'},
    {'blocks':[{'started_at':'2026-09-19T00:15:00Z','ended_at':'2026-09-18T23:50:00Z'}]},
    {'blocks':[{'started_at':'2026-09-18T23:50:00Z','ended_at':'2026-09-19T00:25:00Z'}, {'started_at':'2026-09-19T00:20:00Z','ended_at':'2026-09-19T00:30:00Z'}]},
    {'blocks':None},
])
def test_invalid_timing_rejects_entire_record(change):
    client=TestClient(app)
    assert client.post('/sessions',json=timed_body(**change)).status_code==422
    assert client.get('/sessions').json()==[]


def test_dst_and_subminute_midnight_allocation_count_real_time_once():
    client=TestClient(app)
    body=timed_body(client_id='dst', started_at='2026-03-08T01:50:00-06:00', ended_at='2026-03-08T03:10:00-05:00',actual_minutes=20,
        blocks=[{'started_at':'2026-03-08T01:50:00-06:00','ended_at':'2026-03-08T03:10:00-05:00'}])
    assert client.post('/sessions',json=body).status_code==200
    week=client.get('/history/week?start=2026-03-02&timezone=America/Chicago').json()
    assert week['days'][-1]['minutes']==20
    body=timed_body(client_id='small',started_at='2026-09-18T23:59:30Z',ended_at='2026-09-19T00:00:40Z',actual_minutes=1,
        blocks=[{'started_at':'2026-09-18T23:59:30Z','ended_at':'2026-09-19T00:00:40Z'}])
    assert client.post('/sessions',json=body).status_code==200
    week=client.get('/history/week?start=2026-09-14&timezone=UTC').json()
    assert sum(day['minutes'] for day in week['days'])==1
    assert sum(day['seconds'] for day in week['days'])==70
    assert client.get('/history/week?start=2026-09-14&timezone=invalid').status_code==422


def test_edit_keeps_deleted_task_snapshot_and_does_not_change_plan():
    client=TestClient(app)
    old=client.post('/standalone-tasks',json={'title':'Original work'}).json()
    other=client.post('/standalone-tasks',json={'title':'Still open'}).json()
    session=client.post('/sessions',json=timed_body(tasks=[{'task_id':old['id'],'completed':True}])).json()
    assert client.delete(f"/tasks/{old['id']}").status_code==200
    body={'revision':0,'summary':'Corrected\nreflection','attributions':[{'attribution_id':session['attributions'][0]['id'],'completed':False},{'task_id':other['id'],'completed':True}]}
    result=client.patch(f"/sessions/{session['id']}",json=body)
    assert result.status_code==200, result.text
    result=result.json()
    assert result['revision']==1
    assert result['summary']=='Corrected\nreflection'
    assert result['attributions'][0]['task_title']=='Original work' and result['attributions'][0]['task_id'] is None
    assert result['blocks']==session['blocks']
    options=client.get('/history/task-options').json()
    assert next(task for task in options if task['id']==other['id'])['completed'] is False
    assert client.patch(f"/sessions/{session['id']}",json=body).status_code==409
    assert client.get(f"/sessions/{session['id']}").json()['revision']==1


def test_edit_rejects_foreign_and_duplicate_attributions_atomically():
    client=TestClient(app)
    task=client.post('/standalone-tasks',json={'title':'A task'}).json()
    first=client.post('/sessions',json=timed_body(tasks=[{'task_id':task['id']}])).json()
    second=client.post('/sessions',json=timed_body(client_id='second',tasks=[{'task_id':task['id']}])).json()
    for attributions in ([{'attribution_id':second['attributions'][0]['id']}], [{'attribution_id':first['attributions'][0]['id']},{'task_id':task['id']}], [{'task_id':9999}]):
        response=client.patch(f"/sessions/{first['id']}",json={'revision':0,'summary':'No change','attributions':attributions})
        assert response.status_code in (422,404)
        assert client.get(f"/sessions/{first['id']}").json()['revision']==0
        assert client.get(f"/sessions/{first['id']}").json()['summary'] is None


def test_export_includes_legacy_deleted_timed_plan_and_queue_without_secrets(monkeypatch):
    monkeypatch.setenv('PRIVATE_SECRET','must-not-export')
    client=TestClient(app)
    task=client.post('/standalone-tasks',json={'title':'Export me'}).json()
    assert client.put('/queue',json={'ordered_ids':[task['id']]}).status_code == 200
    timed=client.post('/sessions',json=timed_body(tasks=[{'task_id':task['id']}])).json()
    client.delete(f"/sessions/{timed['id']}")
    legacy=client.post('/sessions',json={'planned_minutes':25,'actual_minutes':7,'completed':True}).json()
    assert legacy['started_at'] is None and legacy['blocks']==[]
    response=client.get('/export');data=response.json()
    assert 'attachment' in response.headers['content-disposition']
    assert data['format']=='flowlist' and data['schema_version']==1
    assert len(data['sessions'])==2 and data['sessions'][0]['deleted_at'] is not None
    assert len(data['sessions'][0]['blocks'])==2
    assert data['tasks'][0]['title']=='Export me'
    assert data['queue'][0]['task_id']==task['id']
    assert 'must-not-export' not in response.text


def test_ai_cannot_replace_a_manually_corrected_history_title(monkeypatch):
    from app.services.titles import improve_focus_title
    monkeypatch.setattr('app.services.titles.suggest_focus_title',lambda *_:'Old AI title')
    client=TestClient(app)
    session=client.post('/sessions',json=timed_body()).json()
    client.patch(f"/sessions/{session['id']}",json={'revision':0,'summary':'My correction','attributions':[]})
    improve_focus_title(session['id'],None,[])
    assert client.get(f"/sessions/{session['id']}").json()['task_title']=='My correction'
