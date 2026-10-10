"""
Who sees what. Every list the API returns passes through here.

                     Requester                Analyst                          Team lead
Tickets              own tickets              assigned to them + requested     all
Predicted hours/risk expected completion only own queue                       everything
Counts / dept view   own department status    no                              yes
Workload in hours    no                       own only                        every analyst
Feedback             own deliverable ratings  own feedback                    all
Deliverables         own tickets'             own work                        full library
Leave                no                       own requests                    all; approves
Override log         no                       no                              yes

No role ever sees a ranking of analysts by speed. In the demo the role comes from the
selector at the top of the app; a real version would use the company's login.
"""
from __future__ import annotations
import re
from fastapi import HTTPException
from fairqueue.db import repo
from fairqueue.engine import risk

PREDICTION_FIELDS = ("pred_low", "pred_likely", "pred_high", "pred_method", "confidence",
                     "p_miss", "cause", "explanation", "facts", "action", "actual_hours")


def require(role: str, *allowed: str) -> None:
    if role not in allowed:
        raise HTTPException(403, f"The {role} view can't see this.")


def analyst_id_for(user: str | None) -> int:
    a = repo.get_analyst_by_name(user or "")
    if not a:
        raise HTTPException(400, f"'{user}' is not an analyst.")
    return a["id"]


def _with_risk(tickets: list[dict]) -> list[dict]:
    scores = {r["ticket_id"]: r for r in risk.score_all()}
    out = []
    for t in tickets:
        r = scores.get(t["id"], {})
        out.append({**t, "p_miss": r.get("p_miss"), "cause": r.get("cause"),
                    "explanation": r.get("explanation"), "facts": r.get("facts"),
                    "action": r.get("action"), "alert": r.get("alert", False),
                    "expected_completion": r.get("expected_completion")})
    return out


def _requester_shape(t: dict) -> dict:
    out = {k: v for k, v in t.items() if k not in PREDICTION_FIELDS}
    if t["status"] == "Closed":
        out["expected_completion"] = (t.get("closed_at") or "")[:10]
    elif t.get("assignee_id") is None:
        out["expected_completion"] = None
        out["expected_note"] = "Waiting for an analyst to be assigned"
    return out


def tickets_for(role: str, user: str | None, division: str | None = None,
                status: str | None = None) -> list[dict]:
    if role == "lead":
        return _with_risk(repo.get_tickets(status=status, division=division))
    if role == "analyst":
        aid = analyst_id_for(user)
        mine = _with_risk(repo.get_tickets(assignee_id=aid, status=status))
        for t in mine:
            t["relation"] = "assigned"
        requested = [{**_requester_shape(t), "relation": "requested"}
                     for t in _with_risk(repo.get_tickets(requester=user, status=status))
                     if t.get("assignee_id") != aid]
        return mine + requested
    if role == "requester":
        return [_requester_shape(t) for t in _with_risk(repo.get_tickets(requester=user, status=status))]
    raise HTTPException(400, "Unknown role")


# ── Similar work already delivered ─────────────────────────────────────────────

_STOP = {"the", "and", "for", "with", "from", "this", "that", "report", "analysis", "data",
         "request", "please", "need", "into", "our", "new"}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower())
            if (len(w) > 2 or any(c.isdigit() for c in w)) and w not in _STOP}


def similar_work(title: str, description: str | None = None, category: str | None = None,
                 exclude_ticket: int | None = None, limit: int = 3) -> list[dict]:
    """Keyword retrieval over past deliverable titles and summaries (no vector store needed
    at this size; a vector store is the roadmap item when the library grows)."""
    query = _words(f"{title} {description or ''}")
    if not query:
        return []
    scored = []
    for d in repo.get_deliverables():
        if d["ticket_id"] == exclude_ticket or d["kind"] == "None":
            continue
        doc = _words(f"{d['ticket_title']} {d.get('title') or ''} {d.get('summary') or ''}")
        overlap = query & doc
        if not overlap:
            continue
        # Share of the new request's words that the past work covers
        score = len(overlap) / len(query) + (0.1 if category and d.get("category") == category else 0)
        if score >= 0.4:
            scored.append({"deliverable_id": d["id"], "ticket_id": d["ticket_id"],
                           "title": d.get("title") or d["ticket_title"], "summary": d.get("summary"),
                           "delivered_on": (d.get("uploaded_at") or "")[:10], "division": d["division"],
                           "score": round(score, 2), "matched": sorted(overlap)})
    scored.sort(key=lambda x: -x["score"])
    return scored[:limit]
