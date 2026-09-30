"""Commit a Plan create and its retry receipt in the same transaction."""
import hashlib
import json
from collections.abc import Callable
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models import PlanMutationModel


def create_once(db: Session, key: UUID | None, path: str, payload: BaseModel,
                schema: type[BaseModel], create: Callable):
    receipt = None
    if key is not None:
        identity = f"{db.info.get('owner_id') or 'local'}:{key}"
        encoded = json.dumps([path, payload.model_dump(mode='json')], sort_keys=True, separators=(',', ':'))
        fingerprint = hashlib.sha256(encoded.encode()).hexdigest()

        def replay():
            existing = db.scalar(select(PlanMutationModel).where(PlanMutationModel.id == identity))
            if existing is None:
                return None
            if existing.fingerprint != fingerprint:
                raise HTTPException(409, 'This request ID was already used for different work')
            return schema.model_validate_json(existing.response)

        if (response := replay()) is not None:
            return response
        receipt = PlanMutationModel(id=identity, fingerprint=fingerprint, response='')
        db.add(receipt)
        try:
            db.flush()
        except IntegrityError:
            # A concurrent request committed this receipt while this one waited.
            db.rollback()
            if (response := replay()) is not None:
                return response
            raise
    try:
        entity = create()
        db.flush()
        response = schema.model_validate(entity)
        if receipt is not None:
            receipt.response = response.model_dump_json()
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise
