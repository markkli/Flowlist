from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Flowlist API")


class GoalCreate(BaseModel):
    title: str
    description: str | None = None


class Goal(GoalCreate):
    id: int


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None


goals: list[Goal] = []
next_id = 1


def find_goal(goal_id: int) -> Goal:
    for goal in goals:
        if goal.id == goal_id:
            return goal
    raise HTTPException(status_code=404, detail="Goal not found")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/goals", response_model=Goal)
def create_goal(goal: GoalCreate):
    global next_id
    new_goal = Goal(id=next_id, **goal.model_dump())
    goals.append(new_goal)
    next_id += 1
    return new_goal


@app.get("/goals", response_model=list[Goal])
def list_goals():
    return goals


@app.get("/goals/{goal_id}", response_model=Goal)
def get_goal(goal_id: int):
    return find_goal(goal_id)


@app.patch("/goals/{goal_id}", response_model=Goal)
def update_goal(goal_id: int, updates: GoalUpdate):
    goal = find_goal(goal_id)
    for field, value in updates.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    return goal


@app.delete("/goals/{goal_id}")
def delete_goal(goal_id: int):
    goal = find_goal(goal_id)
    goals.remove(goal)
    return {"deleted": True}
