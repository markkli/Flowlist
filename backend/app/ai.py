import os

from openai import OpenAI
from pydantic import BaseModel

focus_title_model = os.environ.get("OPENAI_FOCUS_TITLE_MODEL", "gpt-5.4-mini")


class FocusTitle(BaseModel):
    title: str


class AIConfigurationError(RuntimeError):
    """Raised when an optional AI feature is requested without configuration."""


def get_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise AIConfigurationError(
            "AI history titles are not configured. Add OPENAI_API_KEY to enable it."
        )
    return OpenAI(api_key=api_key, timeout=15.0, max_retries=0)


def suggest_focus_title(summary: str | None, task_contexts: list[str]) -> str:
    """Turn a ritual note or its attributed work into a compact history title."""
    context = "\n".join(f"- {item}" for item in task_contexts) or "- No tasks selected"
    result = get_client().responses.parse(
        model=focus_title_model,
        input=[
            {
                "role": "system",
                "content": (
                    "Write a calm, specific title for a focus-session history record. "
                    "Use 3-8 words, sentence case, and a plain noun or action phrase. "
                    "Find the shared theme when several tasks are listed. Do not join task "
                    "names with punctuation, mention counts, use quotes, or add a period."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User note: {summary or 'No note provided.'}\n"
                    f"Work attributed to:\n{context}"
                ),
            },
        ],
        text_format=FocusTitle,
    )
    return result.output_parsed.title
