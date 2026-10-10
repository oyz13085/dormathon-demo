"""Tickets, the status flow, deliverables and feedback."""
from __future__ import annotations
import re
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fairqueue import views
from fairqueue.config import BACKEND_DIR, UPLOADS_DIR
from fairqueue.contracts import (FeedbackIn, PriorityChange, RatingIn, StatusChange,
                                 SuggestRequest, TicketCreate)
from fairqueue.db import repo

router = APIRouter()

TRANSITIONS = {           # status flow; Closed only via /close, reopening only via a revision rating
    "Assigned": {"In progress"},
    "In progress": {"Waiting"},
    "Waiting": {"In progress"},
}
ALLOWED_FILE_TYPES = {"pdf", "xlsx", "xls", "csv", "pptx", "png", "jpg", "jpeg", "docx", "ipynb"}


# ── Lists and summaries ────────────────────────────────────────────────────────

@router.get("/")
def list_tickets(role: str = Query("lead"), user: str | None = None,
                 division: str | None = None, status: str | None = None):
    return views.tickets_for(role, user, division, status)


@router.get("/summary")
def summary(role: str = Query("lead"), user: str | None = None, division: str | None = None):
    """Ticket counts. Lead: whole team and every department. Requester: own department only."""
    if role == "requester":
        mine = repo.get_tickets(requester=user)
        div = division or (mine[0]["division"] if mine else None)
        if not div:
            return {"team": None, "departments": []}
        rows = repo.department_summary(div)
        for r in rows:
            r.pop("hours_in_queue", None)
        return {"team": None, "departments": rows}
    views.require(role, "lead")
    from fairqueue.engine.risk import score_all
    scores = score_all()
    depts = repo.department_summary(division)
    for d in depts:
        d["at_risk"] = sum(1 for r in scores if r["division"] == d["division"] and r["alert"])
    team = repo.team_summary(division)
    team["at_risk"] = sum(1 for r in scores if r["alert"] and (not division or r["division"] == division))
    return {"team": team, "departments": depts}


# ── Submitting a ticket ────────────────────────────────────────────────────────

@router.post("/suggest")
def suggest(body: SuggestRequest):
    """AI suggestions shown on the request form: category, priority with a KPI-based reason,
    estimated hours, a recommended assignee (high-confidence types only) and similar past work.
    Built by the suggest agent (agents/suggest.py): a real tool-calling loop with an API key,
    the same tools in fixed order without one."""
    from agents.suggest import run
    s = run(body.title, body.deadline, body.description or "", body.requester)
    return {"division": s["division"], "division_method": s["division_method"],
            "category": s["category"], "category_method": s["category_method"], "confidence": s["confidence"],
            "priority": s["priority"], "priority_reason": s["priority_reason"], "priority_method": s["priority_method"],
            "hours": s["hours"],
            "recommendation": _requester_card(s["card"]),
            "similar_work": s["similar_work"]}


def _requester_card(card: dict) -> dict:
    """What the person deciding the assignment sees: names, fit and the one-line reason."""
    keep = ("analyst_id", "name", "fit", "explanation", "low_confidence",
            "breakdown", "free_hours", "open_hours", "past_in_category", "past_with_requester")
    pick = lambda c: {k: c[k] for k in keep if k in c} if c else None
    return {"decision": card["decision"], "note": card.get("note"), "explanation": card.get("explanation"),
            "recommended": pick(card.get("recommended")), "usual_partner": pick(card.get("usual_partner")),
            "support": pick(card.get("support"))}


@router.post("/", status_code=201)
def create_ticket(body: TicketCreate):
    from fairqueue.llm import extract_category
    from fairqueue.models.hours import known_categories, predict_hours
    from fairqueue.engine.fit import recommend

    if body.category:
        known = known_categories()
        cat = {"category": body.category, "confidence": "High" if body.category in known else "Low"}
    else:
        cat = extract_category(body.title, body.description or "", known_categories())
    pred = predict_hours(cat["category"], body.priority, body.division)
    confidence = "Low" if "Low" in (cat["confidence"], pred["confidence"]) else "High"
    tid = repo.create_ticket(body.requester, body.division, body.title, body.description,
                             cat["category"], body.priority, body.deadline, pred, confidence)

    if body.suggested_priority:
        repo.cache_agent_output(tid, "priority", {"priority": body.suggested_priority}, "submitted")
        if body.suggested_priority != body.priority:
            repo.log_priority_change(tid, body.suggested_priority, body.priority,
                                     "Requester changed the suggestion", body.requester)

    if body.assignee_id and confidence == "High":
        from fairqueue.assignment.router import do_assign
        card = recommend(repo.get_ticket(tid))
        do_assign(tid, body.assignee_id, body.override_reason, None, body.requester, card)
    return repo.get_ticket(tid)


# ── One ticket ─────────────────────────────────────────────────────────────────

@router.get("/{ticket_id}")
def get_ticket(ticket_id: int, role: str = Query("lead"), user: str | None = None):
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, f"Ticket {ticket_id} not found")
    visible = {x["id"]: x for x in views.tickets_for(role, user)}
    if ticket_id not in visible:
        raise HTTPException(403, "Not visible in this view")
    out = dict(visible[ticket_id])
    out["deliverables"] = repo.get_deliverables(ticket_id=ticket_id)
    if role == "lead":
        out["assignments"] = [a for a in repo.assignment_log() if a["ticket_id"] == ticket_id]
        out["similar_work"] = views.similar_work(t["title"], t.get("description"), t.get("category"), ticket_id)
        out["priority_suggestion"] = repo.get_cached_agent_output(ticket_id, "priority")
    return out


@router.patch("/{ticket_id}/status")
def change_status(ticket_id: int, body: StatusChange):
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if body.status not in TRANSITIONS.get(t["status"], set()):
        raise HTTPException(400, f"Can't move a ticket from {t['status']} to {body.status}")
    repo.set_status(ticket_id, body.status)
    return repo.get_ticket(ticket_id)


@router.patch("/{ticket_id}/priority")
def change_priority(ticket_id: int, body: PriorityChange):
    """The lead has the final say on priority."""
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if body.priority != t["priority"]:
        repo.log_priority_change(ticket_id, t["priority"], body.priority, body.reason, body.by)
        repo.set_priority(ticket_id, body.priority)
    return repo.get_ticket(ticket_id)


@router.post("/{ticket_id}/close")
async def close_ticket(
    ticket_id: int,
    analyst_id: int = Form(...),
    actual_hours: float = Form(...),
    kind: str = Form(...),                         # File | Link | None
    summary: str = Form(""),
    title: str | None = Form(None),
    url: str | None = Form(None),
    file: UploadFile | None = File(None),
    estimate_rating: str | None = Form(None),
    better_suited_id: int | None = Form(None),
    comment: str | None = Form(None),
):
    """A ticket can't close without its output: a file, a link, or "No deliverable" with a reason."""
    t = repo.get_ticket(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t["status"] not in ("In progress", "Waiting", "Assigned"):
        raise HTTPException(400, f"A {t['status']} ticket can't be closed")
    if t["assignee_id"] != analyst_id:
        raise HTTPException(403, "Only the assigned analyst can close this ticket")
    summary = (summary or "").strip()
    file_name = file_path = file_type = None
    if kind == "File":
        if file is None or not file.filename:
            raise HTTPException(400, "Attach the file, or choose Link or No deliverable")
        if not summary:
            raise HTTPException(400, "Add a 2–3 sentence summary: what was asked, what was found, next step")
        file_name = re.sub(r"[^A-Za-z0-9._ -]", "_", file.filename).strip() or "deliverable"
        file_type = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        if file_type not in ALLOWED_FILE_TYPES:
            raise HTTPException(400, f"File type .{file_type} isn't accepted")
        folder = UPLOADS_DIR / f"ticket_{ticket_id}"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / file_name).write_bytes(await file.read())
        file_path = f"uploads/ticket_{ticket_id}/{file_name}"
    elif kind == "Link":
        if not (url or "").startswith(("http://", "https://")):
            raise HTTPException(400, "Paste the dashboard, notebook or Drive link (http/https)")
        if not summary:
            raise HTTPException(400, "Add a 2–3 sentence summary: what was asked, what was found, next step")
    elif kind == "None":
        if not summary:
            raise HTTPException(400, "Write one line on why there's nothing to hand over")
    else:
        raise HTTPException(400, "kind must be File, Link or None")

    repo.add_deliverable(ticket_id, analyst_id, kind, title or (file_name if kind == "File" else t["title"]),
                         file_name, file_path, url if kind == "Link" else None, file_type, summary)
    repo.close_ticket(ticket_id, actual_hours)
    analyst = repo.get_analyst(analyst_id)
    if estimate_rating or better_suited_id or comment:
        repo.add_feedback(ticket_id, analyst["name"] if analyst else None, "analyst", actual_hours,
                          estimate_rating or None, better_suited_id or None, comment or None)
    return repo.get_ticket(ticket_id)


# ── Feedback ───────────────────────────────────────────────────────────────────

@router.post("/{ticket_id}/feedback")
def add_feedback(ticket_id: int, body: FeedbackIn):
    """About the estimate and the fit for this ticket type, never a score for a person."""
    if not repo.get_ticket(ticket_id):
        raise HTTPException(404, "Ticket not found")
    fid = repo.add_feedback(ticket_id, body.given_by, body.role, body.actual_hours,
                            body.estimate_rating, body.better_suited_id, body.comment)
    return {"id": fid}


feedback_router = APIRouter()


@feedback_router.get("/")
def list_feedback(role: str = Query("lead"), user: str | None = None):
    if role == "lead":
        return repo.get_feedback()
    if role == "analyst":
        return repo.get_feedback(given_by=user)
    if role == "requester":   # their own ratings of deliverables
        return [{"ticket_id": d["ticket_id"], "title": d["ticket_title"], "rating": d["requester_rating"],
                 "note": d["revision_note"], "version": d["version"]}
                for d in repo.get_deliverables(requester=user) if d["requester_rating"]]
    raise HTTPException(400, "Unknown role")


# ── Deliverables ───────────────────────────────────────────────────────────────

deliverables_router = APIRouter()


@deliverables_router.get("/")
def list_deliverables(role: str = Query("lead"), user: str | None = None,
                      division: str | None = None, category: str | None = None,
                      q: str | None = None, date_from: str | None = None, date_to: str | None = None):
    if role == "requester":
        return repo.get_deliverables(requester=user, q=q)
    if role == "analyst":
        return repo.get_deliverables(analyst_id=views.analyst_id_for(user), q=q)
    views.require(role, "lead")
    return repo.get_deliverables(division=division, category=category, q=q,
                                 date_from=date_from, date_to=date_to)


@deliverables_router.get("/stats")
def deliverable_stats():
    return {"revisions_by_category": repo.revision_stats()}


@deliverables_router.get("/similar")
def similar(title: str, description: str | None = None, category: str | None = None):
    return views.similar_work(title, description, category)


@deliverables_router.get("/{deliverable_id}/open")
def open_deliverable(deliverable_id: int):
    d = repo.get_deliverable(deliverable_id)
    if not d:
        raise HTTPException(404, "Deliverable not found")
    if d["kind"] == "Link" and d.get("url"):
        return RedirectResponse(d["url"])
    if d["kind"] != "File" or not d.get("file_path"):
        raise HTTPException(404, "This deliverable has no file")
    path = (UPLOADS_DIR / d["file_path"].removeprefix("uploads/")).resolve()
    if UPLOADS_DIR.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path, filename=d.get("file_name") or path.name)


@deliverables_router.patch("/{deliverable_id}/rate")
def rate(deliverable_id: int, body: RatingIn):
    """Useful, or Needs revision (reopens the ticket; the next upload becomes a new version)."""
    d = repo.get_deliverable(deliverable_id)
    if not d:
        raise HTTPException(404, "Deliverable not found")
    if body.by and body.by != d["requester"]:
        raise HTTPException(403, "Only the requester can rate this deliverable")
    if body.rating == "Needs revision" and not (body.note or "").strip():
        raise HTTPException(400, "Say what needs to change")
    repo.rate_deliverable(deliverable_id, body.rating, body.note)
    return repo.get_deliverable(deliverable_id)
