import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fairqueue.assignment.router import router as assignment
from fairqueue.lifecycle.router import router as lifecycle, deliverables_router, feedback_router
from fairqueue.planning.router import router as planning
from fairqueue.prediction.router import router as prediction
from fairqueue.requester.router import router as requester
from fairqueue.leave_advisor.router import router as leave_advisor


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed only when there is no database yet (run `python -m fairqueue.db.seed` to reset the
    # demo), and train the models if they haven't been trained.
    from fairqueue.config import ARTIFACTS_DIR
    from fairqueue.db.repo import DB_PATH
    if not os.path.exists(DB_PATH):
        from fairqueue.db.seed import seed
        seed()
    if not (ARTIFACTS_DIR / "hours_model.pkl").exists():
        from fairqueue.models.train import train_all
        train_all()
    yield


app = FastAPI(title="FairQueue API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_URL", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lifecycle, prefix="/tickets", tags=["tickets"])
app.include_router(deliverables_router, prefix="/deliverables", tags=["deliverables"])
app.include_router(feedback_router, prefix="/feedback", tags=["feedback"])
app.include_router(prediction, prefix="/prediction", tags=["prediction"])
app.include_router(assignment, prefix="/assignment", tags=["assignment"])
app.include_router(planning, prefix="/planning", tags=["planning"])
app.include_router(requester, prefix="/requester", tags=["requester"])
app.include_router(leave_advisor, prefix="/leave-advisor", tags=["leave advisor"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/meta")
def meta():
    """Everything the role switcher and forms need."""
    from fairqueue.config import DEPARTMENTS, LLM, ALERT_THRESHOLD, ALERTS_PER_DAY
    from fairqueue.db import repo
    from fairqueue.llm import llm_enabled
    from fairqueue.models.hours import known_categories
    return {"departments": DEPARTMENTS, "categories": known_categories(),
            "analysts": [{"id": a["id"], "name": a["name"], "role_title": a.get("role_title")}
                         for a in repo.get_analysts()],
            "requesters": repo.get_requesters(),
            "llm": {"model": LLM["model"], "enabled": llm_enabled()},
            "alerts": {"threshold": ALERT_THRESHOLD, "max_per_day": ALERTS_PER_DAY}}


@app.post("/planning/ask")
def ask(question: str):
    from agents.planning import run
    return run(question)
