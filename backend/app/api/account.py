import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.auth import Identity, get_identity, remove_auth_user
from app.database import get_db, engine
from app.models import UserModel, GoalModel, FocusSessionModel
from app.tenancy import TenantSession

router = APIRouter()


@router.get('/account')
def account(identity: Identity = Depends(get_identity), db: Session = Depends(get_db)):
    return {'id': identity.id, 'email': identity.email, 'mode': 'local' if identity.id is None else 'supabase'}


class Deletion(BaseModel):
    confirmation: str


@router.delete('/account')
def delete_account(body: Deletion, identity: Identity = Depends(get_identity)):
    if not identity.id:
        raise HTTPException(400, 'Account deletion is unavailable in local mode.')
    if body.confirmation != 'DELETE':
        raise HTTPException(422, 'Type DELETE to confirm account deletion.')
    if not os.getenv('SUPABASE_SECRET_KEY'):
        raise HTTPException(503, 'Account deletion is not configured. Contact the beta owner.')
    # Commit a tombstone before external deletion: stale access tokens cannot
    # recreate an account if Supabase is unavailable. This route allows retries.
    with TenantSession(bind=engine, info={'owner_id': identity.id}) as db:
        user = db.scalar(select(UserModel).where(UserModel.id == identity.id).with_for_update())
        if user is None:
            user = UserModel(id=identity.id)
            db.add(user)
        user.deleted_at = datetime.now(timezone.utc)
        db.execute(delete(FocusSessionModel))
        db.execute(delete(GoalModel))
        db.commit()
    remove_auth_user(identity.id)
    return {'deleted': True}
