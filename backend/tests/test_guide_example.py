from test_ritual_flow import app, clean_test_database
from fastapi.testclient import TestClient


def test_example_is_idempotent_and_removal_preserves_other_projects_and_history():
    client=TestClient(app)
    original=client.post('/goals',json={'title':'My project'}).json()
    first=client.post('/guide/example').json()
    assert first['is_example'] and len(first['tasks'])==5
    assert len([t for t in first['tasks'] if t['depth']==2])==2
    assert client.post('/guide/example').json()['id']==first['id']
    assert len(client.get('/goals').json())==2
    task=first['tasks'][0]
    client.post(f"/queue/{task['id']}")
    session=client.post('/sessions',json={'client_id':'sample-history','planned_minutes':25,'actual_minutes':5,'completed':False,'tasks':[{'task_id':task['id'],'completed':False}]}).json()
    assert client.delete(f"/guide/example/{original['id']}").status_code==409
    assert client.delete(f"/guide/example/{first['id']}").status_code==200
    assert client.get('/queue').json()==[]
    assert client.get(f"/goals/{original['id']}").status_code==200
    record=client.get(f"/sessions/{session['id']}").json()
    assert record['attributions'][0]['task_title']==task['title']
    assert record['attributions'][0]['task_id'] is None


def test_new_project_and_first_task_are_created_together_after_validation():
    client=TestClient(app)
    response=client.post('/goals/with-task',json={'title':'New project','task':{'title':'First task'}})
    assert response.status_code==200, response.text
    assert len(response.json()['tasks'])==1
    assert not response.json()['is_example']
    assert client.post('/goals/with-task',json={'title':'Invalid project','task':{'title':' '}}).status_code==422
    assert len(client.get('/goals').json())==1
