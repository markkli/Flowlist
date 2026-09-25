"""Isolation tests run through authentication and the real request-scoped session."""
import os
from uuid import uuid4
import pytest
import httpx
from fastapi.testclient import TestClient
from test_ritual_flow import app, clean_test_database
from app import auth
from app.database import SessionLocal
from app.models import GoalModel, FocusSessionModel, UserModel

A, B = str(uuid4()), str(uuid4())

def test_admin_deletion_uses_secret_api_key_and_handles_provider_outage(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setenv('SUPABASE_URL','https://beta.supabase.co')
    monkeypatch.setenv('SUPABASE_SECRET_KEY','sb_secret_test')
    def delete(url, **kwargs):
        assert url == f'https://beta.supabase.co/auth/v1/admin/users/{A}'
        assert kwargs['headers'] == {'apikey':'sb_secret_test'}
        return httpx.Response(200, json={})
    monkeypatch.setattr(httpx,'delete',delete)
    auth.remove_auth_user(A)
    monkeypatch.setattr(httpx,'delete',lambda *args,**kwargs:httpx.Response(503))
    with pytest.raises(HTTPException) as error:
        auth.remove_auth_user(A)
    assert error.value.status_code == 503
    assert 'retry' in error.value.detail

@pytest.fixture
def clients(monkeypatch):
    monkeypatch.setenv('FLOWLIST_AUTH_MODE','supabase')
    monkeypatch.setenv('SUPABASE_URL','https://beta.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','sb_publishable_test')
    monkeypatch.setenv('FLOWLIST_BETA_EMAILS','a@example.com,b@example.com')
    def verify(token):
        if token not in (A,B):
            from fastapi import HTTPException
            raise HTTPException(401,'Invalid or expired token')
        return {'id':token,'email':('a' if token==A else 'b')+'@example.com','email_confirmed_at':'2026-09-21'}
    monkeypatch.setattr(auth,'verify_access_token',verify)
    return TestClient(app,headers={'Authorization':f'Bearer {A}'}),TestClient(app,headers={'Authorization':f'Bearer {B}'})


def seed(client,title):
    goal=client.post('/goals',json={'title':title}).json()
    response=client.post(f"/goals/{goal['id']}/tasks",json={'title':title+' task'})
    assert response.status_code==200,response.text
    task=response.json()
    client.put('/queue',json={'ordered_ids':[task['id']]})
    body={'client_id':'same-client-id','actual_minutes':10,'planned_minutes':10,'completed':True,'summary':title,'tasks':[{'task_id':task['id'],'completed':False}]}
    response=client.post('/sessions',json=body)
    assert response.status_code==200,response.text
    return goal,task,response.json(),body


def test_every_read_and_export_is_private_and_same_client_id_is_independent(clients):
    a,b=clients
    ga,ta,sa,bodya=seed(a,'Alice private')
    gb,tb,sb,bodyb=seed(b,'Bob private')
    assert a.post('/sessions',json=bodya).json()['id']==sa['id']
    assert sa['id']!=sb['id']
    for path in ['/goals','/focus-options','/next-focus','/queue','/dashboard','/sessions','/history/task-options','/history/week?start=2026-09-21','/export']:
        ra,rb=a.get(path),b.get(path)
        assert ra.status_code==rb.status_code==200,(path,ra.text,rb.text)
        assert 'Bob private' not in ra.text,path
        assert 'Alice private' not in rb.text,path
    assert a.get('/stats').json()['total_sessions']==1
    assert b.get('/stats').json()['total_minutes']==10
    assert [x['id'] for x in a.get('/goals').json()]==[ga['id']]
    assert a.get('/export').headers['cache-control']=='no-store'


def test_guessed_ids_cannot_read_edit_delete_restore_or_attach(clients):
    a,b=clients
    ga,ta,sa,_=seed(a,'Alice')
    gb,tb,sb,_=seed(b,'Bob')
    attempts=[('get',f"/goals/{gb['id']}",None),('get',f"/goals/{gb['id']}/tasks",None),
      ('patch',f"/goals/{gb['id']}",{'title':'Stolen'}),('delete',f"/goals/{gb['id']}",None),
      ('post',f"/goals/{gb['id']}/tasks",{'title':'Bad'}),('patch',f"/tasks/{tb['id']}",{'completed':True}),
      ('delete',f"/tasks/{tb['id']}",None),('post',f"/tasks/{tb['id']}/subtasks",{'title':'Bad'}),
      ('get',f"/sessions/{sb['id']}",None),('delete',f"/sessions/{sb['id']}",None),
      ('post',f"/sessions/{sb['id']}/restore",None),('patch',f"/sessions/{sb['id']}",{'revision':0,'summary':'Stolen','attributions':[]}),
      ('post',f"/queue/{tb['id']}",None),('put','/queue',{'ordered_ids':[ta['id'],tb['id']]}),
      ('post','/tasks/reorder',{'ordered_ids':[ta['id'],tb['id']]}),
      ('post','/sessions',{'actual_minutes':1,'planned_minutes':1,'completed':True,'tasks':[{'task_id':tb['id'],'completed':True}]}),
      ('patch',f"/sessions/{sa['id']}",{'revision':0,'summary':None,'attributions':[{'task_id':tb['id'],'completed':True}]})]
    for method,path,body in attempts:
        response=a.request(method,path,**({'json':body} if body is not None else {}))
        assert response.status_code==404,(method,path,response.text)
    a.delete(f"/queue/{tb['id']}")
    assert b.get('/queue').json()[0]['task']['id']==tb['id']
    assert b.get(f"/sessions/{sb['id']}").json()['summary']=='Bob'


def test_queue_replacement_and_deletion_do_not_touch_another_account(clients):
    a,b=clients
    ga,ta,sa,_=seed(a,'Alice')
    gb,tb,sb,_=seed(b,'Bob')
    assert a.put('/queue',json={'ordered_ids':[]}).status_code==200
    assert len(b.get('/queue').json())==1
    assert a.delete(f"/goals/{ga['id']}").status_code==200
    assert b.get(f"/goals/{gb['id']}").status_code==200
    assert len(b.get('/export').json()['tasks'])==1


def test_unclaimed_local_records_are_never_given_to_the_first_user(clients):
    with SessionLocal() as db:
        db.add(GoalModel(title='Local secret',goal_type='project'))
        db.commit()
    a,b=clients
    assert a.get('/goals').json()==b.get('/goals').json()==[]
    response=a.post('/goals',json={'title':'Own','owner_id':B})
    with SessionLocal() as db:
        assert db.get(GoalModel,response.json()['id']).owner_id==A
        assert db.query(GoalModel).filter_by(title='Local secret').one().owner_id is None


def test_missing_invalid_expired_tokens_and_invites_are_rejected(clients,monkeypatch):
    for header in [None,'Bearer expired','Bearer forged','Basic x']:
        response=TestClient(app).get('/goals',headers={'Authorization':header} if header else {})
        assert response.status_code==401
    monkeypatch.setenv('FLOWLIST_BETA_EMAILS','a@example.com')
    assert clients[1].get('/goals').status_code==403
    monkeypatch.setattr(auth,'verify_access_token',lambda token:{'id':A,'email':'a@example.com'})
    assert clients[0].get('/goals').status_code==403


def test_supabase_verification_fails_closed_on_rejection_outage_and_malformed_data(monkeypatch):
    monkeypatch.setenv('FLOWLIST_AUTH_MODE','supabase')
    monkeypatch.setenv('SUPABASE_URL','https://beta.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY','sb_publishable_test')
    for status in [401,403,500]:
        monkeypatch.setattr(auth.httpx,'get',lambda *args,**kwargs:httpx.Response(status,json={'message':'error'}))
        assert TestClient(app,headers={'Authorization':'Bearer untrusted'}).get('/goals').status_code==(401 if status<500 else 503)
    def timeout(*args,**kwargs): raise httpx.ConnectTimeout('timeout')
    monkeypatch.setattr(auth.httpx,'get',timeout)
    assert TestClient(app,headers={'Authorization':'Bearer x'}).get('/goals').status_code==503


def test_account_deletion_is_isolated_retryable_and_blocks_old_tokens(clients,monkeypatch):
    from app.api import account
    a,b=clients
    seed(a,'Alice');seed(b,'Bob')
    monkeypatch.setenv('SUPABASE_SECRET_KEY','server-only')
    calls=[]
    monkeypatch.setattr(account,'remove_auth_user',lambda subject:calls.append(subject))
    assert a.request('DELETE','/account',json={'confirmation':'no'}).status_code==422
    assert a.request('DELETE','/account',json={'confirmation':'DELETE'}).status_code==200
    assert calls==[A]
    assert a.get('/goals').status_code==403
    assert len(b.get('/goals').json())==1
    with SessionLocal() as db:
        assert db.query(GoalModel).filter_by(owner_id=A).count()==0
        assert db.query(FocusSessionModel).filter_by(owner_id=A).count()==0
        assert db.get(UserModel,A).deleted_at is not None
    assert a.request('DELETE','/account',json={'confirmation':'DELETE'}).status_code==200


def test_public_config_excludes_secrets_and_production_rejects_local_mode(clients,monkeypatch):
    monkeypatch.setenv('SUPABASE_SECRET_KEY','never-expose-this')
    response=TestClient(app).get('/config')
    assert response.status_code==200 and 'never-expose-this' not in response.text
    assert response.json()['signup_enabled'] is False
    assert response.json()['google_enabled'] is False
    assert response.json()['email_enabled'] is False
    monkeypatch.setenv('FLOWLIST_EMAIL_LOGIN','true')
    assert TestClient(app).get('/config').json()['email_enabled'] is True
    monkeypatch.setenv('FLOWLIST_GOOGLE_LOGIN','true')
    assert TestClient(app).get('/config').json()['google_enabled'] is True
    monkeypatch.setenv('FLOWLIST_ENV','production');monkeypatch.setenv('FLOWLIST_AUTH_MODE','local')
    assert TestClient(app).get('/config').status_code==503


def test_large_mutations_are_rejected_before_authentication(clients):
    response=TestClient(app).post('/goals',content=b'x'*(1024*1024+1))
    assert response.status_code==413
