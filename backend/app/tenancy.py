"""Request ORM isolation covers joins, loaders, aggregates and bulk DML.

SessionLocal is for administrative work only. API data access must use get_db.
Raw SQL and bulk ORM inserts are forbidden in a user-scoped session.
"""
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.orm import Session, with_loader_criteria
from app.models import GoalModel, TaskModel, FocusSessionModel, FocusQueueModel, FocusSessionTaskModel, FocusBlockModel


class TenantSession(Session):
    pass


@event.listens_for(TenantSession, 'do_orm_execute')
def scope_queries(state):
    if not state.is_orm_statement or state.is_insert:
        raise RuntimeError('Use validated ORM objects in a user-scoped session')
    owner = state.session.info['owner_id']
    goals = select(GoalModel.id).where(GoalModel.owner_id == owner)
    sessions = select(FocusSessionModel.id).where(FocusSessionModel.owner_id == owner)
    tasks = select(TaskModel.id).where(TaskModel.goal_id.in_(goals))
    for model, condition in (
        (GoalModel, GoalModel.owner_id == owner),
        (FocusSessionModel, FocusSessionModel.owner_id == owner),
        (TaskModel, TaskModel.goal_id.in_(goals)),
        (FocusQueueModel, FocusQueueModel.task_id.in_(tasks)),
        (FocusSessionTaskModel, FocusSessionTaskModel.session_id.in_(sessions)),
        (FocusBlockModel, FocusBlockModel.session_id.in_(sessions)),
    ):
        state.statement = state.statement.options(with_loader_criteria(model, condition, include_aliases=True))


@event.listens_for(TenantSession, 'before_flush')
def guard_writes(db, _context, _instances):
    owner = db.info['owner_id']
    for obj in db.new | db.dirty | db.deleted:
        if isinstance(obj, (GoalModel, FocusSessionModel)):
            if obj in db.new and obj.owner_id is None:
                obj.owner_id = owner
            if obj.owner_id != owner:
                raise HTTPException(404, 'Record not found')
        if obj in db.deleted:
            continue
        refs = []
        if isinstance(obj, TaskModel): refs = [(GoalModel, obj.goal_id), (TaskModel, obj.parent_id)]
        if isinstance(obj, FocusQueueModel): refs = [(TaskModel, obj.task_id)]
        if isinstance(obj, FocusBlockModel): refs = [(FocusSessionModel, obj.session_id)]
        if isinstance(obj, FocusSessionTaskModel): refs = [(FocusSessionModel, obj.session_id), (TaskModel, obj.task_id)]
        for model, key in refs:
            if key is not None and db.get(model, key) is None:
                raise HTTPException(404, 'Related record not found')
