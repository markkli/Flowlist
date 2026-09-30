"""A committed create can be replayed after a response is lost, without duplicates."""
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_ritual_flow import app, clean_test_database
from test_accounts import clients, A, B
from app.database import SessionLocal
from app.models import PlanMutationModel


def test_replay_all_plan_create_types_and_reject_changed_payload():
    client = TestClient(app)
    def once(path, body):
        headers = {'Idempotency-Key': str(uuid4())}
        first = client.post(path, json=body, headers=headers)
        assert first.status_code == 200, first.text
        assert client.post(path, json=body, headers=headers).json() == first.json()
        changed = dict(body, title='Different')
        assert client.post(path, json=changed, headers=headers).status_code == 409
        return first.json()
    goal = once('/goals', {'title': 'Project'})
    parent = once(f"/goals/{goal['id']}/tasks", {'title': 'Parent'})
    once(f"/tasks/{parent['id']}/subtasks", {'title': 'Child'})
    once('/standalone-tasks', {'title': 'One-off'})
    combined = once('/goals/with-task', {'title': 'Together', 'task': {'title': 'First'}})
    assert len(combined['tasks']) == 1
    projects = client.get('/goals?include_tasks=true').json()
    assert len(projects) == 3
    assert sum(len(p['tasks']) for p in projects) == 4


def test_validation_failure_rolls_back_receipt_and_malformed_key_is_rejected():
    client = TestClient(app)
    headers = {'Idempotency-Key': str(uuid4())}
    assert client.post('/goals/999/tasks', json={'title': 'Missing'}, headers=headers).status_code == 404
    with SessionLocal() as db:
        assert db.scalar(select(PlanMutationModel)) is None
    assert client.post('/goals', json={'title': 'Bad key'}, headers={'Idempotency-Key':'arbitrary text'}).status_code == 422


def test_receipts_are_private_survive_item_deletion_and_clear_with_account(clients, monkeypatch):
    a, b = clients
    headers = {'Idempotency-Key': str(uuid4())}
    body = {'title': 'Same request'}
    first = a.post('/goals', json=body, headers=headers).json()
    other = b.post('/goals', json=body, headers=headers).json()
    assert first['id'] != other['id']
    assert a.delete(f"/goals/{first['id']}").status_code == 200
    assert a.post('/goals', json=body, headers=headers).json() == first
    assert a.get('/goals').json() == []  # A retry cannot resurrect a deleted item.
    from app import auth
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'sb_secret_test')
    monkeypatch.setattr('app.api.account.remove_auth_user', lambda _: None)
    response = a.request('DELETE', '/account', json={'confirmation': 'DELETE'})
    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        assert db.scalar(select(PlanMutationModel).where(PlanMutationModel.owner_id == A)) is None
        assert db.scalar(select(PlanMutationModel).where(PlanMutationModel.owner_id == B)) is not None
