"""
Deadline risk with cause labels (rules — the rule is the explanation).

Chance of missing comes from the queue arithmetic in schedule.py. Each ticket at
risk gets one cause:

  Leave conflict       the analyst's approved leave removes the hours it needs
  Overloaded assignee  open predicted hours above weekly hours, or 30% above the team average
  Skill mismatch       the assignee has little history on this ticket type
  Underestimated type  this category's actual hours have run >15% above estimates
  Volume spike         the department's forecast for this week exceeds its usual volume
  Tight deadline       none of the above: the deadline itself is short
  Not yet assigned     still unassigned and the clock is running

At-risk tickets are ranked by risk × business impact. Alerts are only raised at or
above ALERT_THRESHOLD and capped at ALERTS_PER_DAY.
"""
from __future__ import annotations
from datetime import date
from fairqueue.config import ALERT_THRESHOLD, ALERTS_PER_DAY
from fairqueue.db import repo
from fairqueue.engine import schedule
from fairqueue.engine.schedule import Slot

PRIORITY_WEIGHT = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}
KPI_WORDS = ("payroll", "month-end", "board", "cfo", "close", "launch", "audit", "accrual")

ACTIONS = {
    "Leave conflict": "Reassign before the leave starts",
    "Overloaded assignee": "Move this or an earlier ticket to someone with free hours",
    "Skill mismatch": "Add a supporting analyst or reassign to a better-matched analyst",
    "Underestimated type": "Plan for the high estimate; split or add buffer",
    "Volume spike": "Warn the department and protect capacity this week",
    "Tight deadline": "Agree a later deadline or reduce scope with the requester",
    "Not yet assigned": "Assign today",
    "On track": "No action needed",
}


def business_impact(t: dict) -> float:
    w = PRIORITY_WEIGHT.get(t.get("priority") or "Medium", 2)
    text = f"{t.get('title', '')} {t.get('description') or ''}".lower()
    kpi = any(k in text for k in KPI_WORDS)
    return w * (1.5 if kpi else 1.0)


def _category_bias() -> dict[str, float]:
    """Mean actual / estimated hours per category, from closed tickets and feedback."""
    ratios: dict[str, list[float]] = {}
    for t in repo.closed_ticket_history():
        if t.get("pred_likely") and t.get("actual_hours"):
            ratios.setdefault(t["category"], []).append(t["actual_hours"] / t["pred_likely"])
    return {c: sum(v) / len(v) for c, v in ratios.items() if len(v) >= 3}


def _context():
    analysts = {a["id"]: a for a in repo.get_analysts()}
    loads = {aid: schedule.open_hours(aid) for aid in analysts}
    avg = sum(loads.values()) / len(loads) if loads else 0
    from fairqueue.engine.forecast import spike_divisions
    from fairqueue.engine.fit import _stats
    return {"analysts": analysts, "loads": loads, "avg": avg, "bias": _category_bias(),
            "spikes": spike_divisions(), "stats": _stats()}


def label(t: dict, s: Slot, ctx: dict) -> tuple[str, str, list[str]]:
    """(cause, one-sentence explanation, three supporting facts)"""
    title, dl = t["title"], s.deadline.strftime("%a %d %b")
    est = f"Needs {s.likely:g}h (range {s.low:g}–{s.high:g}h)"
    if s.analyst_id is None:
        if s.p_miss < ALERT_THRESHOLD:
            return "On track", f"'{title}' is unassigned but there is still time before {dl}.", [est, f"{s.available:g} working hours until the deadline", "Waiting for assignment"]
        return ("Not yet assigned", f"'{title}' is still unassigned and is due {dl}; every day it waits makes the deadline harder.",
                [est, f"Only {s.available:g} working hours until the deadline", f"Priority {t.get('priority')}"])

    a = ctx["analysts"].get(s.analyst_id, {"name": "the analyst", "weekly_hours": 40})
    name, load = a["name"], ctx["loads"].get(s.analyst_id, 0)
    queue = f"{name}'s open work: {load:g}h vs {a.get('weekly_hours', 40):g}h a week"
    ahead = f"{len(s.queue_ahead)} earlier-deadline ticket(s) ({s.hours_before:g}h) queued ahead"
    facts_base = [est, f"{s.available:g}h left for it before {dl}", queue]

    if s.p_miss < 0.3:
        return "On track", f"'{title}' should finish before {dl}.", facts_base

    if s.leave_hours_lost > 0 and s.available + s.leave_hours_lost >= s.likely:
        return ("Leave conflict", f"{name}'s approved leave removes {s.leave_hours_lost:g}h before {dl}, so '{title}' won't fit.",
                [est, f"{s.leave_hours_lost:g}h of leave before the deadline", f"{s.available:g}h left for it after leave"])
    if load > float(a.get("weekly_hours") or 40) or (ctx["avg"] and load > 1.3 * ctx["avg"]):
        return ("Overloaded assignee", f"{name} has {load:g}h of open work against {a.get('weekly_hours', 40):g}h a week, so '{title}' is likely to slip past {dl}.",
                [est, ahead, f"Team average is {ctx['avg']:.0f}h"])
    by_cat = ctx["stats"][0]
    past = len(by_cat.get((s.analyst_id, t.get("category")), []))
    if past < 2:
        return ("Skill mismatch", f"{name} has handled {past} {t.get('category')} ticket(s) before, so '{title}' carries extra risk before {dl}.",
                [est, f"{past} past {t.get('category')} tickets for {name}", f"{s.available:g}h left for it"])
    bias = ctx["bias"].get(t.get("category"), 1.0)
    if bias > 1.15:
        return ("Underestimated type", f"{t.get('category')} tickets have taken {round((bias - 1) * 100)}% longer than estimated, so '{title}' may need more than {s.likely:g}h.",
                [est, f"Past {t.get('category')} tickets ran {bias:.2f}× their estimate", f"{s.available:g}h left for it"])
    if t.get("division") in ctx["spikes"]:
        return ("Volume spike", f"{t.get('division')} is in a volume spike this week, and '{title}' competes with it before {dl}.",
                [est, ctx["spikes"][t["division"]], queue])
    return ("Tight deadline", f"'{title}' needs about {s.likely:g}h but only {s.available:g}h are left before {dl}.",
            [est, ahead, queue])


def score_all(extra_leave: dict | None = None) -> list[dict]:
    slots = schedule.full_schedule(extra_leave)
    ctx = _context()
    out = []
    for t in repo.get_tickets():
        if t["status"] == "Closed" or t["id"] not in slots:
            continue
        s = slots[t["id"]]
        cause, sentence, facts = label(t, s, ctx)
        impact = business_impact(t)
        out.append({
            "ticket_id": t["id"], "ticket_title": t["title"], "division": t["division"],
            "priority": t["priority"], "status": t["status"], "deadline": t["deadline"],
            "assignee_id": s.analyst_id,
            "assignee_name": ctx["analysts"].get(s.analyst_id, {}).get("name") if s.analyst_id else None,
            "p_miss": s.p_miss, "cause": cause, "explanation": sentence, "facts": facts,
            "action": ACTIONS[cause], "impact": impact, "risk_x_impact": round(s.p_miss * impact, 2),
            "hours_needed": s.likely, "hours_available": round(s.available, 1),
            "expected_completion": s.finish.isoformat() if s.finish else None,
            "alert": s.p_miss >= ALERT_THRESHOLD,
        })
    return out


def risk_list(division: str | None = None) -> dict:
    items = [r for r in score_all() if not division or r["division"] == division]
    at_risk = sorted([r for r in items if r["alert"]], key=lambda r: -r["risk_x_impact"])
    return {
        "threshold": ALERT_THRESHOLD, "cap_per_day": ALERTS_PER_DAY,
        "alerts": at_risk[:ALERTS_PER_DAY],
        "suppressed": len(at_risk) - min(len(at_risk), ALERTS_PER_DAY),
        "watch": sorted([r for r in items if not r["alert"] and r["p_miss"] >= 0.3], key=lambda r: -r["p_miss"]),
        "all": items,
        "as_of": date.today().isoformat(),
    }


def ticket_risk(ticket_id: int) -> dict | None:
    return next((r for r in score_all() if r["ticket_id"] == ticket_id), None)
