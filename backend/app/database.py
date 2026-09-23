import os

from fastapi import Depends, HTTPException
from app.auth import get_identity, Identity
from dotenv import load_dotenv
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not configured. Copy backend/.env.example to "
        "backend/.env and set DATABASE_URL before starting Flowlist."
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db(identity: Identity = Depends(get_identity)):
    from app.tenancy import TenantSession
    from app.models import UserModel
    from sqlalchemy.exc import IntegrityError
    db = TenantSession(bind=engine, autoflush=False, info={'owner_id': identity.id})
    try:
        if identity.id:
            user = db.scalar(select(UserModel).where(UserModel.id == identity.id).with_for_update())
            if user is None:
                db.add(UserModel(id=identity.id))
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                user = db.scalar(select(UserModel).where(UserModel.id == identity.id).with_for_update())
            # Serialize account requests with deletion until the route commits.
            # A request waiting behind deletion must observe the tombstone.
            if user is None or user.deleted_at is not None:
                raise HTTPException(403, 'This account has been deleted.')
        yield db
    finally:
        db.close()
