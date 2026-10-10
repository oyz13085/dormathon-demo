"""Volume forecast, leave requests and the what-if check."""
from __future__ import annotations
from datetime import date
from fastapi import APIRouter, HTTPException, Query
from fairqueue import views
from fairqueue.contracts import LeaveDecision, LeaveIn
from fairqueue.db import repo
from fairqueue.engine.forecast import forecast as _forecast
from fairqueue.engine.whatif import whatif_leave

router = APIRouter()


@router.get("/forecast")
def forecast(n_weeks: int = Query(2, ge=1, le=8), division: str | None = None):
    return _forecast(n_weeks, division)


@router.get("/whatif/leave")
def whatif(analyst_id: int, start_date: str, end_date: str):
    return whatif_leave(analyst_id, start_date, end_date)


@router.get("/leave")
def list_leave(role: str = Query("lead"), user: str | None = None, status: str | None = None):
    """Lead: every request. Pending and upcoming approved leave get the what-if result attached,
    so the lead can see (and reassign) the tickets that need cover. Analyst: own requests."""
    if role == "analyst":
        return repo.get_leave(analyst_id=views.analyst_id_for(user), status=status)
    views.require(role, "lead")
    rows = repo.get_leave(status=status)
    today = date.today().isoformat()
    for l in rows:
        if l["status"] == "Requested":
            l["whatif"] = whatif_leave(l["analyst_id"], l["start_date"], l["end_date"])
        elif l["status"] == "Approved" and l["end_date"] >= today:
            l["whatif"] = whatif_leave(l["analyst_id"], l["start_date"], l["end_date"], leave_id=l["id"])
    return rows


@router.post("/leave", status_code=201)
def request_leave(body: LeaveIn):
    """Requesting leave automatically runs the what-if check for the team lead."""
    if body.end_date < body.start_date:
        raise HTTPException(400, "The leave ends before it starts")
    if not repo.get_analyst(body.analyst_id):
        raise HTTPException(400, "Unknown analyst")
    lid = repo.create_leave(body.analyst_id, body.start_date, body.end_date, body.reason)
    return {**repo.get_leave_by_id(lid), "whatif": whatif_leave(body.analyst_id, body.start_date, body.end_date)}


@router.patch("/leave/{leave_id}")
def decide_leave(leave_id: int, body: LeaveDecision):
    if not repo.get_leave_by_id(leave_id):
        raise HTTPException(404, "Leave request not found")
    repo.update_leave_status(leave_id, body.status)
    return repo.get_leave_by_id(leave_id)
