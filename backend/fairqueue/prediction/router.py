"""Hours prediction, deadline risk, the replay proof, retraining and model checks."""
from __future__ import annotations
import json
from fastapi import APIRouter, HTTPException
from fairqueue.config import ARTIFACTS_DIR
from fairqueue.db import repo
from fairqueue.engine import risk

router = APIRouter()
_replay_cache: dict = {}


@router.get("/hours/{ticket_id}")
def hours(ticket_id: int):
    from fairqueue.models.hours import predict_hours
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, f"Ticket {ticket_id} not found")
    return {"ticket_id": ticket_id, **predict_hours(t.get("category") or "", t["priority"], t["division"])}


@router.get("/risk")
def risk_summary(division: str | None = None):
    """Alerts (above threshold, capped per day, ranked by risk × business impact) and a watch list."""
    return risk.risk_list(division)


@router.get("/risk/{ticket_id}")
def risk_single(ticket_id: int):
    r = risk.ticket_risk(ticket_id)
    if not r:
        raise HTTPException(404, "No open ticket with that id")
    return r


@router.get("/replay")
def replay(refresh: bool = False):
    from fairqueue.sim.replay import run_replay
    key = json.dumps(repo.get_fit_settings(), sort_keys=True, default=str)
    if refresh or _replay_cache.get("key") != key:
        _replay_cache["key"], _replay_cache["result"] = key, run_replay()
    return _replay_cache["result"]


@router.get("/model-report")
def model_report():
    path = ARTIFACTS_DIR / "model_report.json"
    if not path.exists():
        raise HTTPException(404, "Models not trained yet. POST /prediction/retrain")
    return json.loads(path.read_text())


@router.post("/retrain")
def retrain():
    """Retrain on the history plus live closed tickets (actual hours from closing and feedback)."""
    import pandas as pd
    from fairqueue.models.train import train_all
    rows = []
    for t in repo.get_tickets(status="Closed"):
        fb = [f for f in repo.get_feedback(ticket_id=t["id"]) if f.get("actual_hours")]
        hours = fb[0]["actual_hours"] if fb else t.get("actual_hours")
        if hours and t.get("assignee_name"):
            rows.append({"created_at": pd.Timestamp(t["created_at"]), "category": t["category"],
                         "priority": t["priority"], "division": t["division"], "actual_hours": hours,
                         "assignee": t["assignee_name"], "requester": t["requester"],
                         "handovers": 0, "experience": 0})
    report = train_all(pd.DataFrame(rows) if rows else None)
    _replay_cache.clear()
    return {**report, "live_tickets_added": len(rows)}


@router.get("/underestimated")
def underestimated():
    """Ticket types that regularly take longer than estimated (from closed tickets and feedback)."""
    return repo.underestimated_types()
