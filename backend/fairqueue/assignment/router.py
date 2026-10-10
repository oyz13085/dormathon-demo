"""Recommendations, accept/override, handovers, workload, fit settings and skill adjustments."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Query
from fairqueue import views
from fairqueue.contracts import ApprovalIn, AssignRequest, FitWeights, SkillAdjustmentIn
from fairqueue.db import repo
from fairqueue.engine import fit, schedule

router = APIRouter()


@router.get("/recommend/{ticket_id}")
def recommend(ticket_id: int):
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, f"Ticket {ticket_id} not found")
    card = fit.recommend(t)
    card["similar_work"] = views.similar_work(t["title"], t.get("description"), t.get("category"), ticket_id)
    card["current_assignee_id"] = t.get("assignee_id")
    return card


def do_assign(ticket_id: int, analyst_id: int, override_reason: str | None,
              support_id: int | None, decided_by: str | None, card: dict | None = None) -> dict:
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t["status"] == "Closed":
        raise HTTPException(400, "Closed tickets can't be reassigned")
    if not repo.get_analyst(analyst_id):
        raise HTTPException(400, "Unknown analyst")
    card = card or fit.recommend(t)
    rec = card.get("recommended")
    chosen = next((c for c in card["candidates"] if c["analyst_id"] == analyst_id), None)
    accepted = bool(rec) and rec["analyst_id"] == analyst_id
    if rec and not accepted and not (override_reason or "").strip():
        raise HTTPException(400, "Give a reason for overriding the recommendation")
    if card["decision"] == "low_confidence" and not (override_reason or "").strip():
        override_reason = "Lead decision on a low-confidence ticket"

    # A handover: the ticket already had a different analyst
    last = [a for a in repo.assignment_log() if a["ticket_id"] == ticket_id]
    previous = t.get("assignee_id") or (last[0]["chosen_id"] if last else None)
    is_handover = previous is not None and previous != analyst_id

    repo.create_assignment(ticket_id, rec["analyst_id"] if rec else None, rec["fit"] if rec else None,
                           analyst_id, chosen["fit"] if chosen else None, accepted,
                           None if accepted else override_reason, decided_by, support_id, is_handover)
    repo.set_assignee(ticket_id, analyst_id)
    if t["status"] in ("In progress", "Waiting"):
        repo.set_status(ticket_id, t["status"])   # keep work state when handing over mid-flight
    return {"ticket": repo.get_ticket(ticket_id), "accepted": accepted, "handover": is_handover}


@router.get("/move-impact/{ticket_id}")
def move_impact(ticket_id: int):
    """Reassign / support options for a risky ticket: each analyst's chance of making the
    deadline if it moves to them, their availability, and which of their own tickets it would hurt."""
    from fairqueue.engine.whatif import whatif_move
    out = whatif_move(ticket_id)
    if out is None:
        raise HTTPException(404, "Open ticket not found")
    return out


@router.post("/assign")
def assign(body: AssignRequest):
    return do_assign(body.ticket_id, body.analyst_id, body.override_reason, body.support_id, body.decided_by)


@router.post("/unassign/{ticket_id}")
def unassign(ticket_id: int):
    """Back to Unassigned (e.g. the analyst goes on leave). The next assignment counts as a handover."""
    t = repo.get_ticket(ticket_id)
    if not t or t["status"] == "Closed":
        raise HTTPException(400, "Only open tickets can be unassigned")
    repo.set_assignee(ticket_id, None)
    return repo.get_ticket(ticket_id)


@router.get("/log")
def override_log():
    log = repo.assignment_log()
    return {"assignments": log, "override_rate": repo.override_rate(),
            "handovers": sum(a["is_handover"] for a in log), "priority_changes": repo.priority_log()}


@router.get("/workload")
def workload(role: str = Query("lead"), user: str | None = None, division: str | None = None):
    """Open predicted hours per analyst against weekly hours. Analysts see only their own."""
    if role == "analyst":
        analysts = [repo.get_analyst(views.analyst_id_for(user))]
    else:
        views.require(role, "lead")
        analysts = repo.get_analysts()
    out = []
    for a in analysts:
        tickets = [t for t in repo.get_tickets(assignee_id=a["id"]) if t["status"] in schedule.OPEN_ASSIGNED
                   and (not division or t["division"] == division)]
        hours = round(sum(schedule.ticket_hours(t)[1] for t in tickets), 1)
        out.append({"analyst_id": a["id"], "name": a["name"], "role_title": a.get("role_title"),
                    "skills": [s for s in (a.get("skills") or "").split(",") if s],
                    "weekly_hours": a["weekly_hours"], "open_hours": hours, "open_tickets": len(tickets),
                    "on_leave": [l for l in repo.get_leave(analyst_id=a["id"], status="Approved")]})
    return out


@router.get("/analysts")
def analysts():
    return [{"id": a["id"], "name": a["name"], "role_title": a.get("role_title")} for a in repo.get_analysts()]


@router.get("/settings")
def get_settings():
    return repo.get_fit_settings()


@router.put("/settings")
def update_settings(w: FitWeights):
    total = w.w_skill + w.w_track + w.w_pairing + w.w_capacity + w.w_deadline
    if abs(total - 1) > 0.01:
        raise HTTPException(400, f"Weights must add up to 1 (they add up to {total:.2f})")
    if w.poor_fit > w.good_fit:
        raise HTTPException(400, "The poor-fit threshold must be at or below the good-fit threshold")
    repo.save_fit_settings(w.model_dump(), w.updated_by)
    return repo.get_fit_settings()


@router.get("/skills")
def list_skills(analyst_id: int | None = None):
    return repo.list_skill_adjustments(analyst_id)


@router.post("/skills", status_code=201)
def add_skill(body: SkillAdjustmentIn):
    """Lead: applied straight away. Analyst self-flag ("I'm comfortable with this type"): waits for approval."""
    if body.role == "analyst":
        if body.adjustment <= 0:
            raise HTTPException(400, "A self-flag can only raise a skill")
        return {"id": repo.add_skill_adjustment(body.analyst_id, body.category, body.adjustment,
                                                body.reason, body.set_by, approved=False)}
    if not (body.reason or "").strip():
        raise HTTPException(400, "Give a reason for the adjustment")
    return {"id": repo.add_skill_adjustment(body.analyst_id, body.category, body.adjustment,
                                            body.reason, body.set_by, approved=True)}


@router.patch("/skills/{adj_id}")
def approve_skill(adj_id: int, body: ApprovalIn):
    repo.set_skill_adjustment_approval(adj_id, body.approved)
    return {"ok": True}
