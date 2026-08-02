import os

from openai import OpenAI
from pydantic import BaseModel

model = os.environ.get("OPENAI_SUBTASK_MODEL", "gpt-5.4-mini")


class SuggestedSubtask(BaseModel):
    title: str
    estimated_minutes: int


class Breakdown(BaseModel):
    subtasks: list[SuggestedSubtask]


class AIConfigurationError(RuntimeError):
    """Raised when an optional AI feature is requested without configuration."""


def get_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise AIConfigurationError(
            "AI task breakdown is not configured. Add OPENAI_API_KEY to enable it."
        )
    return OpenAI(api_key=api_key)


def suggest_subtasks(goal_title: str, task_title: str) -> list[SuggestedSubtask]:
    result = get_client().responses.parse(
        model=model,
        input=[
            {
                "role": "system",
                "content": (
                    "Break a task into 3-6 concrete, non-overlapping subtasks. "
                    "Each subtask should be doable in one focused sitting. "
                    "Give a realistic estimated_minutes (5-90) for each."
                ),
            },
            {
                "role": "user",
                "content": f"Goal: {goal_title}\nTask to break down: {task_title}",
            },
        ],
        text_format=Breakdown,
    )
    return result.output_parsed.subtasks
