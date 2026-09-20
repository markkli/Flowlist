"""UTC storage, local calendar boundaries, and consistent minute allocation."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import HTTPException


def zone_for(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Unknown timezone")


def midnight_utc(day, zone):
    return datetime.combine(day, time.min, zone).astimezone(timezone.utc).replace(tzinfo=None)


def session_days(session, zone):
    # Legacy records have no reliable work date; retain their saved-date basis.
    if session.started_at is None:
        day = session.created_at.replace(tzinfo=timezone.utc).astimezone(zone).date()
        return {day: {"seconds": session.actual_minutes * 60, "minutes": session.actual_minutes}}
    days = {}
    cumulative = 0
    for block in session.blocks:
        cursor = block.started_at
        while cursor < block.ended_at:
            day = cursor.replace(tzinfo=timezone.utc).astimezone(zone).date()
            end = min(block.ended_at, midnight_utc(day + timedelta(days=1), zone))
            seconds = int((end - cursor).total_seconds())
            row = days.setdefault(day, {"seconds": 0, "minutes": 0})
            row["seconds"] += seconds
            row["minutes"] += (cumulative + seconds) // 60 - cumulative // 60
            cumulative += seconds
            cursor = end
    if not days:
        day = session.started_at.replace(tzinfo=timezone.utc).astimezone(zone).date()
        days[day] = {"seconds": 0, "minutes": 0}
    return days
