"""
Leave advisor API, mounted at /leave-advisor.

POST /preview is the one endpoint that calls the AI (Groq, through agent.py). POST /reassign hands one of the
analyst's own tickets to its recommended colleague immediately, through the existing do_assign(); nothing here
changes a leave request's status, which stays with the Team Lead. Submitting creates the leave request through the existing
repo.create_leave (the same Requested row the Team Lead approves today) and stores the proposed handover next
to it. The demo has no login; identity is the role switcher's.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from fairqueue.db import repo
from fairqueue.engine.whatif import whatif_leave
from fairqueue.leave_advisor import plan, store
from fairqueue.leave_advisor.schemas import (LeaveInput, LeaveSubmit, ReassignIn, Reassigned, StoredPlan, Submitted,
                                             Suggestions)

router = APIRouter(dependencies=[Depends(store.ensure_schema)])


def _own_in_progress(body: LeaveInput) -> dict[int, float]:
    """Hours left only count for the analyst's own In progress tickets; anything else is rejected."""
    mine = {t["id"]: t for t in repo.get_tickets(assignee_id=body.analyst_id)}
    for tid in body.hours_left:
        if tid not in mine or mine[tid]["status"] != "In progress":
            raise HTTPException(400, f"Hours left can only be given for your own In progress tickets (#{tid} isn't one)")
    return dict(body.hours_left)


@router.post("/preview", response_model=Suggestions)
def preview(body: LeaveInput):
    """Affected tickets and one suggested replacement each, chosen by the AI and checked by the backend.
    Cached per analyst, dates and data, so repeated calls for the same dates don't call the AI again."""
    return plan.build(body.analyst_id, body.start_date, body.end_date, _own_in_progress(body))


@router.post("/requests", status_code=201, response_model=Submitted)
def submit(body: LeaveSubmit):
    """Send the leave request with the proposed handover attached. Never reassigns anything. Reuses the cached
    suggestions the analyst just saw; leave can be sent even when the AI was unavailable."""
    hours_left = _own_in_progress(body)
    p = plan.build(body.analyst_id, body.start_date, body.end_date, hours_left)
    if not p["valid"]:
        raise HTTPException(400, " ".join(p["errors"]))
    by_ticket = {t["ticket_id"]: t for t in p["tickets"]}
    choices = {tid: "keep" for tid in by_ticket}                    # keep is the default
    for tid, choice in body.choices.items():
        if tid not in by_ticket:
            raise HTTPException(400, f"Ticket #{tid} isn't one of the affected tickets")
        if choice == "reassign" and not by_ticket[tid]["recommended"]:
            raise HTTPException(400, f"Ticket #{tid} has no suitable replacement to hand it to")
        choices[tid] = choice
    # Proposals come from the jointly checked recommendations, so their combined workload has already been validated;
    # keeping some tickets only frees capacity
    proposed = [{"ticket_id": tid, "title": by_ticket[tid]["title"], "to": by_ticket[tid]["recommended"],
                 "status": "Proposed: Team Lead approval required"} for tid, c in choices.items() if c == "reassign"]
    stored = {**p, "choices": choices, "proposed_handovers": proposed}
    lid = repo.create_leave(body.analyst_id, body.start_date, body.end_date, body.reason)
    plan_id = store.save_plan(lid, body.analyst_id, stored, {}, hours_left)
    return {"leave": repo.get_leave_by_id(lid), "plan_id": plan_id, "proposed_handovers": proposed,
            "whatif": whatif_leave(body.analyst_id, body.start_date, body.end_date), "reassigned": False}


@router.post("/reassign", response_model=Reassigned)
def reassign(body: ReassignIn):
    """Hand one affected ticket to its recommended colleague now, through the existing assignment workflow
    (assignment.router.do_assign, unchanged), and return recalculated suggestions. Analyst-initiated: allowed only
    for your own open ticket, only to the colleague the backend currently recommends for it, and only once."""
    from fairqueue.assignment.router import do_assign
    from fairqueue.engine.schedule import OPEN_ASSIGNED

    analyst = repo.get_analyst(body.analyst_id)
    if not analyst or body.user != analyst["name"]:
        raise HTTPException(403, "Only the analyst going on leave can hand over their own tickets here")
    t = repo.get_ticket(body.ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t["assignee_id"] != body.analyst_id or t["status"] not in OPEN_ASSIGNED:
        raise HTTPException(409, f"Ticket #{body.ticket_id} isn't an open ticket of yours any more"
                                 + (f" (it's with {t['assignee_name']})" if t.get("assignee_name") else ""))
    hours_left = _own_in_progress(body)
    p = plan.build(body.analyst_id, body.start_date, body.end_date, hours_left)
    if not p["valid"]:
        raise HTTPException(400, " ".join(p["errors"]))
    s = next((x for x in p["tickets"] if x["ticket_id"] == body.ticket_id), None)
    if s is None:
        raise HTTPException(409, f"Ticket #{body.ticket_id} isn't affected by these leave dates")
    if not s["recommended"] or s["recommended"]["id"] != body.to_analyst_id:
        raise HTTPException(409, "The recommendation for this ticket has changed. Refresh and check it again.")

    do_assign(body.ticket_id, body.to_analyst_id,
              f"Leave handover from {analyst['name']} ({body.start_date} to {body.end_date}), "
              "recommended by the leave advisor", None, body.user)
    hid = store.record_handover(body.ticket_id, body.analyst_id, body.to_analyst_id, body.start_date, body.end_date,
                                body.user, s["decided_by"] == "ai")
    return {"ticket": repo.get_ticket(body.ticket_id), "handover_id": hid, "to": s["recommended"],
            "decided_by_ai": s["decided_by"] == "ai",
            "suggestions": plan.build(body.analyst_id, body.start_date, body.end_date, hours_left)}


@router.get("/leave/{leave_id}/plan", response_model=StoredPlan)
def stored_plan(leave_id: int, user: str = Query(..., min_length=1), role: str = Query("analyst")):
    """The proposed handover as submitted, for the analyst who asked for the leave and the Team Lead."""
    leave = repo.get_leave_by_id(leave_id)
    p = store.get_plan(leave_id)
    if not leave or not p:
        raise HTTPException(404, "No handover plan for this leave request")
    if role != "lead" and user != leave["analyst_name"]:
        raise HTTPException(403, "Only the analyst and the Team Lead can see this plan")
    return p
