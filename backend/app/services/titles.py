import logging
import re
from app.ai import suggest_focus_title
from app.database import SessionLocal
from app.models import FocusSessionModel, TaskModel

def clean_history_title(value: str, max_length: int = 100) -> str:
    """Normalize user/AI copy without destroying intentional acronym casing."""
    title = " ".join(value.split()).strip(" \t\n\r\"'`.,;:!?-–—")
    if not title:
        return "General focus"
    title = title[0].upper() + title[1:]
    if len(title) <= max_length:
        return title
    shortened = title[: max_length - 1].rsplit(" ", 1)[0]
    return f"{shortened or title[: max_length - 1]}…"


def looks_like_gibberish(value: str) -> bool:
    compact = re.sub(r"\s+", "", value)
    letters = "".join(character.lower() for character in compact if character.isalpha())
    if not letters or len(letters) < max(2, len(compact) // 3):
        return True
    if len(letters) >= 3 and len(set(letters)) <= 2:
        return True
    if len(letters) >= 6 and sum(character in "aeiouy" for character in letters) / len(letters) < 0.18:
        return True
    return False


def fallback_focus_title(tasks: list[TaskModel]) -> str:
    if not tasks:
        return "General focus"
    if len(tasks) == 1:
        return clean_history_title(tasks[0].title)
    goal_titles = {task.goal.title for task in tasks}
    if len(goal_titles) == 1:
        return clean_history_title(f"{next(iter(goal_titles))} focus")
    return "Focused work"


def build_focus_title(summary: str | None, tasks: list[TaskModel]) -> tuple[str, str | None]:
    """Always save locally first; never discard the original reflection."""
    if summary:
        return clean_history_title(summary), summary
    return fallback_focus_title(tasks), None


def improve_focus_title(session_id: int, summary: str | None, contexts: list[str]) -> None:
    """Best-effort enrichment after the response; deletion never recreates a record."""
    try:
        title = clean_history_title(suggest_focus_title(summary, contexts))
        if looks_like_gibberish(title):
            return
        with SessionLocal() as db:
            session = db.get(FocusSessionModel, session_id)
            if session and session.deleted_at is None:
                session.title = title
                db.commit()
    except Exception:
        logging.getLogger(__name__).info("Optional focus title unavailable; kept local title")
