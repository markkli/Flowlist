import os

from openai import OpenAI
from pydantic import BaseModel

model = os.environ.get("OPENAI_SUBTASK_MODEL", "gpt-5.4-mini")


class SuggestedSubtask(BaseModel):
    title: str
    estimated_minutes: int


class Breakdown(BaseModel):
    subtasks: list[SuggestedSubtask]


class ClarificationQuestion(BaseModel):
    id: str
    question: str


class ClarificationSet(BaseModel):
    questions: list[ClarificationQuestion]


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


def suggest_learning_questions(goal_title: str, description: str | None) -> list[ClarificationQuestion]:
    result = get_client().responses.parse(
        model=model,
        input=[
            {
                "role": "system",
                "content": (
                    "Ask 2-4 concise clarification questions before planning a learning path. "
                    "Questions should clarify the learner's current level, desired outcome, available time, "
                    "and preferred project or practice context. Return only useful questions."
                ),
            },
            {
                "role": "user",
                "content": f"Learning objective: {goal_title}\nDescription: {description or 'No description provided.'}",
            },
        ],
        text_format=ClarificationSet,
    )
    return result.output_parsed.questions


def suggest_learning_tasks(
    goal_title: str, description: str | None, answers: list[dict[str, str]]
) -> list[SuggestedSubtask]:
    answer_text = "\n".join(f"{item['id']}: {item['answer']}" for item in answers)
    result = get_client().responses.parse(
        model=model,
        input=[
            {
                "role": "system",
                "content": (
                    "Turn a learning objective into 3-6 staged learning milestones. "
                    "Each milestone should be a meaningful, practice-oriented outcome that can later be broken into smaller steps. "
                    "Give a realistic estimated_minutes (5-90) for each."
                ),
            },
            {
                "role": "user",
                "content": f"Learning objective: {goal_title}\nDescription: {description or 'No description provided.'}\nClarifications:\n{answer_text}",
            },
        ],
        text_format=Breakdown,
    )
    return result.output_parsed.subtasks
