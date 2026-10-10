"""
Fit score: is the usual partner right for this ticket?

    Fit = 100 × (w1·Skill + w2·Track record + w3·Pairing + w4·Capacity + w5·Deadline)

Skill       share of the analyst's past closed tickets in this category (relative to the
            most experienced analyst) blended with declared skills, plus approved adjustments
Track       how close their actual hours came to the estimate on this category, and how
            few revisions were requested
Pairing     past tickets completed for this requester, capped at PAIRING_CAP
Capacity    free hours this week compared with the ticket's high estimate
Deadline    1 − chance of missing the deadline if the ticket joins their queue

The score is per ticket type, never an overall rating of a person, and never a speed ranking.
Analysts with little history on a type get a low-confidence label instead of a low score.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from fairqueue.db import repo
from fairqueue.engine import schedule

PAIRING_CAP = 20          # past tickets together that count as a full pairing score
MIN_HISTORY = 2           # fewer past tickets on this type → low-confidence label
LABELS = {"skill": "skill match", "track": "track record", "pairing": "partnership",
          "capacity": "free capacity", "deadline": "deadline fit"}


@dataclass
class Candidate:
    analyst_id: int
    name: str
    fit: float
    breakdown: dict
    past_in_category: int
    past_with_requester: int
    free_hours: float
    open_hours: float
    low_confidence: bool
    p_handover: float
    explanation: str
    load_penalty: float = 0.0

    def dict(self):
        return asdict(self)


def _stats():
    """Closed-ticket history per analyst, computed once per request."""
    closed = repo.closed_ticket_history()
    by_cat: dict[tuple[int, str], list[dict]] = {}
    by_req: dict[tuple[int, str], int] = {}
    for t in closed:
        by_cat.setdefault((t["assignee_id"], t["category"]), []).append(t)
        by_req[(t["assignee_id"], t["requester"])] = by_req.get((t["assignee_id"], t["requester"]), 0) + 1
    revisions = repo.revision_counts()          # {(analyst_id, category): (n_rated, n_revision)}
    return by_cat, by_req, revisions


def score(analyst: dict, ticket: dict, weights: dict, stats=None, team_avg_hours: float | None = None) -> Candidate:
    by_cat, by_req, revisions = stats or _stats()
    aid, category = analyst["id"], ticket.get("category") or ""
    requester = ticket.get("requester") or ""
    low, likely, high, _ = schedule.ticket_hours(ticket)

    # Skill
    past = by_cat.get((aid, category), [])
    most = max([len(v) for (a, c), v in by_cat.items() if c == category] or [0])
    history_rel = len(past) / most if most else 0.0
    declared = 1.0 if category.lower() in [s.strip().lower() for s in (analyst.get("skills") or "").split(",")] else 0.0
    adj = repo.get_skill_deltas(aid).get(category, 0.0)
    skill = max(0.0, min(0.7 * history_rel + 0.3 * declared + adj, 1.0))

    # Track record on this type
    with_est = [t for t in past if t.get("pred_likely") and t.get("actual_hours")]
    if with_est:
        err = sum(abs(t["actual_hours"] - t["pred_likely"]) / t["pred_likely"] for t in with_est) / len(with_est)
        accuracy = max(0.0, 1.0 - min(err, 1.0))
    else:
        accuracy = 0.5
    rated, revised = revisions.get((aid, category), (0, 0))
    rev_ok = 1.0 - (revised / rated) if rated else 1.0
    track = 0.7 * accuracy + 0.3 * rev_ok

    # Pairing (capped so it can't outweigh skill)
    together = by_req.get((aid, requester), 0)
    pairing = min(together / PAIRING_CAP, 1.0)

    # Capacity
    booked = schedule.open_hours(aid)
    if ticket.get("assignee_id") == aid and ticket.get("status") in schedule.OPEN_ASSIGNED:
        booked -= likely          # don't count the ticket against its own analyst
    free = max(float(analyst.get("weekly_hours") or 40) - booked, 0.0)
    capacity = min(free / high, 1.0) if high else 1.0

    # Deadline: chance of finishing if this ticket joins their queue
    hypo = {**ticket, "id": ticket.get("id") or -1, "status": "Assigned"}
    queue = schedule.analyst_queue(aid, extra_ticket=hypo, exclude={ticket.get("id")})
    slot = next(s for s in queue if s.ticket_id == hypo["id"])
    deadline = 1.0 - slot.p_miss

    bd = {"skill": round(skill, 2), "track": round(track, 2), "pairing": round(pairing, 2),
          "capacity": round(capacity, 2), "deadline": round(deadline, 2)}
    fit = 100 * (weights["w_skill"] * skill + weights["w_track"] * track +
                 weights["w_pairing"] * pairing + weights["w_capacity"] * capacity +
                 weights["w_deadline"] * deadline)

    penalty = 0.0
    if team_avg_hours and booked > team_avg_hours > 0:
        penalty = round(min(10.0, 10.0 * (booked - team_avg_hours) / team_avg_hours), 1)

    from fairqueue.models.handover import predict_handover
    p_h = predict_handover(category, ticket.get("priority") or "Medium",
                           ticket.get("division") or "IT", len(past))

    c = Candidate(analyst_id=aid, name=analyst["name"], fit=round(fit), breakdown=bd,
                  past_in_category=len(past), past_with_requester=together,
                  free_hours=round(free, 1), open_hours=round(booked, 1),
                  low_confidence=len(past) < MIN_HISTORY, p_handover=p_h,
                  explanation="", load_penalty=penalty)
    c.explanation = explain(c, category)
    return c


def explain(c: Candidate, category: str) -> str:
    """One line, e.g. 'Fit 53: strong partnership and free capacity, but only 2 past tickets on Modelling.'"""
    bd = c.breakdown
    good = [LABELS[k] for k, v in sorted(bd.items(), key=lambda kv: -kv[1]) if v >= 0.7][:2]
    weak = []
    if bd["skill"] < 0.4:
        weak.append(f"only {c.past_in_category} past ticket{'s' if c.past_in_category != 1 else ''} on {category}")
    if bd["capacity"] < 0.4:
        weak.append(f"only {c.free_hours:g}h free this week")
    if bd["deadline"] < 0.5:
        weak.append("the deadline is tight with their current queue")
    if bd["pairing"] < 0.2 and not weak:
        weak.append("little history with this requester")
    head = f"Fit {c.fit:g}"
    if c.low_confidence:
        head += " (low confidence: little history on this type)"
    pos = (" and ".join(good)) if good else ""
    if pos and weak:
        return f"{head}: {pos}, but {weak[0]}."
    if pos:
        return f"{head}: {pos}."
    if weak:
        return f"{head}: {'; '.join(weak[:2])}."
    return f"{head}: an average match on every part."


# Who gets the ticket: fit, minus the load penalty, minus a penalty for the chance of missing
# the deadline with that analyst's queue, plus a small nudge for the usual partner. The replay
# showed that weighing deadline risk this directly is what beats count-based balancing.
RISK_PENALTY = 60     # points off per 100% chance of missing
PARTNER_BONUS = 5     # points for the usual partner (continuity, fewer handovers)


def risk_adjusted(fit: float, load_penalty: float, p_miss: float, is_partner: bool) -> float:
    return fit - load_penalty - RISK_PENALTY * p_miss + (PARTNER_BONUS if is_partner else 0)


def candidates(ticket: dict) -> list[Candidate]:
    analysts = repo.get_analysts()
    weights = repo.get_fit_settings()
    stats = _stats()
    loads = [schedule.open_hours(a["id"]) for a in analysts]
    avg = sum(loads) / len(loads) if loads else 0
    cands = [score(a, ticket, weights, stats, avg) for a in analysts]
    # Rank by fit with the load penalty; never by speed
    cands.sort(key=lambda c: c.fit - c.load_penalty, reverse=True)
    return cands


def recommend(ticket: dict) -> dict:
    """The recommendation card. The pick is the best risk-adjusted fit (usual partner nudged up);
    the thresholds on the partner's fit decide how the card explains it."""
    weights = repo.get_fit_settings()
    good, poor = weights["good_fit"], weights["poor_fit"]
    cands = candidates(ticket)
    by_id = {c.analyst_id: c for c in cands}
    low, likely, high, _ = schedule.ticket_hours(ticket)
    partner_id = repo.usual_partner(ticket.get("requester") or "")
    partner = by_id.get(partner_id) if partner_id else None
    best = max(cands, key=lambda c: risk_adjusted(c.fit, c.load_penalty, 1 - c.breakdown["deadline"],
                                                  partner is not None and c.analyst_id == partner.analyst_id)) if cands else None
    miss = lambda c: round((1 - c.breakdown["deadline"]) * 100)

    card = {
        "ticket_id": ticket.get("id"), "title": ticket.get("title"),
        "division": ticket.get("division"), "category": ticket.get("category"),
        "hours": {"low": low, "likely": likely, "high": high},
        "confidence": ticket.get("confidence") or "High",
        "thresholds": {"good_fit": good, "poor_fit": poor},
        "usual_partner": partner.dict() if partner else None,
        "candidates": [c.dict() for c in cands],
        "recommended": None, "support": None, "decision": None, "note": None,
    }

    if (ticket.get("confidence") or "High") == "Low":
        card["decision"] = "low_confidence"
        card["note"] = (f"FairQueue hasn't seen '{ticket.get('category')}' tickets before, so it isn't "
                        "suggesting an assignee. The team lead decides; fit scores are shown for reference.")
        card["explanation"] = card["note"]
        card["facts"] = [f"Hours range is wide: {low:g}–{high:g}h",
                         "No past tickets of this type in the history",
                         f"Most free capacity: {max(cands, key=lambda c: c.free_hours).name}" if cands else ""]
        return card

    if partner is None:
        card["decision"] = "no_partner"
        card["recommended"] = best.dict() if best else None
        card["note"] = "This requester has no usual partner yet, so the best-fitting analyst is recommended."
    elif best is not None and best.analyst_id != partner.analyst_id and partner.fit >= poor:
        card["decision"] = "partner_busy"
        card["recommended"] = best.dict()
        card["note"] = (f"{partner.name} is the usual partner (fit {partner.fit:g}) but is {miss(partner)}% likely to miss "
                        f"the deadline with their current queue. {best.name} is {miss(best)}% likely to miss, so "
                        f"{best.name} is recommended; you can still choose {partner.name}.")
    elif partner.fit >= good:
        card["decision"] = "good"
        card["recommended"] = partner.dict()
        card["note"] = f"Good fit: assign to the usual partner, {partner.name}."
    elif partner.fit >= poor:
        card["decision"] = "possible"
        card["recommended"] = partner.dict()
        helper = next((c for c in cands if c.analyst_id != partner.analyst_id and c.breakdown["skill"] > partner.breakdown["skill"]), None)
        if helper:
            card["support"] = helper.dict()
            card["note"] = (f"Possible fit: low experience with {ticket.get('category')} tickets; "
                            f"consider support from {helper.name}.")
        else:
            card["note"] = "Possible fit: assign to the usual partner and check in on progress."
    else:
        card["decision"] = "poor"
        alt = best if best and best.analyst_id != partner.analyst_id else next((c for c in cands if c.analyst_id != partner.analyst_id), best)
        card["recommended"] = alt.dict() if alt else None
        card["note"] = (f"Poor fit for the usual partner ({partner.name}, fit {partner.fit:g}). "
                        f"Recommending {alt.name if alt else 'another analyst'} instead; the requester or lead can still choose "
                        f"{partner.name}, and the deadline-risk check will flag it early.")

    rec = card["recommended"]
    if rec:
        card["explanation"] = rec["explanation"]
        card["facts"] = _facts(by_id[rec["analyst_id"]], ticket, low, likely, high)
    return card


def _facts(c: Candidate, ticket: dict, low: float, likely: float, high: float) -> list[str]:
    return [
        f"{c.past_in_category} past {ticket.get('category')} tickets, {c.past_with_requester} for this requester",
        f"{c.free_hours:g}h free this week vs {high:g}h high estimate",
        f"{round(c.breakdown['deadline'] * 100)}% chance of meeting the deadline with their queue",
    ]
