"""
What-if: "If Aiman takes leave next week, which deadlines break?"

Reruns the analyst's queue with the leave applied and compares it with the current
plan. A deadline breaks when its chance of missing crosses the alert threshold (or
gets 0.2 worse while already above it). For each broken ticket, the analyst whose
own queue absorbs it with the best fit is suggested as the takeover.
"""
from __future__ import annotations
from fairqueue.config import ALERT_THRESHOLD
from fairqueue.db import repo
from fairqueue.engine import schedule
from fairqueue.engine.fit import candidates


def whatif_leave(analyst_id: int, start_date: str, end_date: str) -> dict:
    analyst = repo.get_analyst(analyst_id) or {"name": f"Analyst {analyst_id}"}
    before = {s.ticket_id: s for s in schedule.analyst_queue(analyst_id)}
    after = schedule.analyst_queue(analyst_id, extra_leave=[(start_date, end_date)])
    tickets = {t["id"]: t for t in repo.get_tickets(assignee_id=analyst_id)}

    broken, unaffected = [], []
    for s in after:
        b = before.get(s.ticket_id)
        t = tickets[s.ticket_id]
        crossed = s.p_miss >= ALERT_THRESHOLD and (b is None or b.p_miss < ALERT_THRESHOLD or s.p_miss - b.p_miss >= 0.2)
        row = {"ticket_id": s.ticket_id, "title": t["title"], "division": t["division"],
               "priority": t["priority"], "deadline": t["deadline"],
               "p_miss_before": b.p_miss if b else None, "p_miss_after": s.p_miss,
               "hours": s.likely, "hours_available_after": round(s.available, 1)}
        if crossed:
            takeover = None
            for c in candidates(t):
                if c.analyst_id == analyst_id:
                    continue
                q = schedule.analyst_queue(c.analyst_id, extra_ticket={**t, "status": "Assigned"})
                slot = next(x for x in q if x.ticket_id == t["id"])
                if slot.p_miss < ALERT_THRESHOLD:
                    takeover = {"analyst_id": c.analyst_id, "name": c.name, "fit": c.fit,
                                "p_miss_if_moved": slot.p_miss, "explanation": c.explanation,
                                "low_confidence": c.low_confidence}
                    break
            row["takeover"] = takeover
            broken.append(row)
        else:
            unaffected.append(row)

    n = len(broken)
    summary = (f"If {analyst['name']} is on leave {start_date} to {end_date}, "
               + (f"{n} deadline{'s' if n != 1 else ''} break." if n else "no deadlines break."))
    return {"analyst_id": analyst_id, "analyst_name": analyst["name"],
            "start_date": start_date, "end_date": end_date, "summary": summary,
            "broken": broken, "unaffected": unaffected}
