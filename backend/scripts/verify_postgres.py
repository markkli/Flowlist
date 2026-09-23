"""Disposable PostgreSQL release check. Never run against a real account database."""
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

root = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
url = os.environ['TEST_DATABASE_URL']
if not make_url(url).database.startswith('flowlist_test'):
    raise SystemExit('Refusing to test a database not named flowlist_test*')
os.environ['DATABASE_URL']=url
os.environ['FLOWLIST_AUTH_MODE']='local'
os.environ['FLOWLIST_ENV']='test'
admin=create_engine(url)
with admin.begin() as db:
    for role in ('anon','authenticated'):
        if not db.scalar(text('SELECT 1 FROM pg_roles WHERE rolname=:name'),{'name':role}):
            db.execute(text(f'CREATE ROLE {role} NOLOGIN'))
subprocess.run([sys.executable,'-m','alembic','upgrade','head'],cwd=root,check=True)
with admin.begin() as db:
    role_sql=(root.parent/'deploy/database-role.sql').read_text()
    if db.scalar(text("SELECT 1 FROM pg_roles WHERE rolname='flowlist_api'")):
        role_sql=role_sql.replace('CREATE ROLE flowlist_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;', '')
    # Grants and policies are database-specific, even when the role already exists.
    db.connection.driver_connection.execute(role_sql,prepare=False)
    for role in ('anon','authenticated'):
        for table in ('goals','tasks','focus_sessions','focus_queue','app_users'):
            assert not db.scalar(text('SELECT has_table_privilege(:role,:table,\'SELECT\')'),{'role':role,'table':table})
    db.execute(text('SET LOCAL ROLE flowlist_api'))
    assert db.scalar(text('SELECT COUNT(*) FROM goals'))==0

from fastapi.testclient import TestClient
from app.main import app
from app.auth import get_identity, Identity
from app.database import get_db
from app.tenancy import TenantSession
from app.models import UserModel

# Exercise the real tenant session under the restricted production role.
subject = str(uuid4())
other = str(uuid4())
def identity(): return Identity(subject,'test@example.com')
def scoped_db():
    with admin.connect() as connection:
        connection.execute(text('SET ROLE flowlist_api'))
        connection.commit()
        with TenantSession(bind=connection,info={'owner_id':subject}) as db:
            if not db.get(UserModel,subject): db.add(UserModel(id=subject));db.commit()
            yield db
        connection.execute(text('RESET ROLE'));connection.commit()
app.dependency_overrides[get_identity]=identity
app.dependency_overrides[get_db]=scoped_db
client=TestClient(app)
g=client.post('/goals',json={'title':'Postgres beta proof'});assert g.status_code==200,g.text
goal=g.json();t=client.post(f"/goals/{goal['id']}/tasks",json={'title':'Private task'});assert t.status_code==200,t.text
task=t.json()
assert client.put('/queue',json={'ordered_ids':[task['id']]}).status_code==200
s=client.post('/sessions',json={'client_id':'pg-test','planned_minutes':1,'actual_minutes':1,'completed':True,'tasks':[{'task_id':task['id'],'completed':False}]})
assert s.status_code==200,s.text
original=subject;subject=other
assert client.get('/goals').json()==[]
assert client.get(f"/goals/{goal['id']}").status_code==404
assert client.put('/queue',json={'ordered_ids':[]}).status_code==200
subject=original
assert len(client.get('/queue').json())==1
assert len(client.get('/export').json()['sessions'])==1
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from sqlalchemy import event
from sqlalchemy.pool import NullPool
from fastapi import HTTPException
from app import database
from app.api import account

restricted=create_engine(url,poolclass=NullPool)
@event.listens_for(restricted,'connect')
def restrict(connection,_record):
    with connection.cursor() as cursor: cursor.execute('SET ROLE flowlist_api')
    connection.commit()
database.engine=restricted
account.engine=restricted
account.remove_auth_user=lambda _subject:None  # No external identity service in this DB test.
os.environ['SUPABASE_SECRET_KEY']='sb_secret_test'
request=get_db(Identity(original,'test@example.com'))
next(request)  # The real dependency holds the account row lock.
started=Event()
def delete_after_request():
    started.set()
    return account.delete_account(account.Deletion(confirmation='DELETE'),Identity(original))
with ThreadPoolExecutor(max_workers=1) as executor:
    deletion=executor.submit(delete_after_request)
    try:
        assert started.wait(2)
        try:
            deletion.result(timeout=0.2)
            raise AssertionError('Deletion did not wait for the in-flight request')
        except TimeoutError:
            pass
    finally:
        request.close()
    assert deletion.result(timeout=5)=={'deleted':True}
try:
    next(get_db(Identity(original)))
    raise AssertionError('A deleted account was recreated')
except HTTPException as error:
    assert error.status_code==403
print('PostgreSQL migrations, restricted role, Data API denial, ownership, queue, export, and deletion locking passed.')
