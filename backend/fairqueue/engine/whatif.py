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


def whatif_move(ticket_id: int) -> dict | None:
    """
    "Who can take this risky ticket, and what does it cost them?"

    For every analyst: rerun their queue with the ticket added, and report the ticket's
    chance of missing there, plus how each of their own tickets shifts. The current
    assignee's queue is rerun without it to show the relief.
    """
    from datetime import date
    t = repo.get_ticket(ticket_id)
    if not t or t["status"] == "Closed":
        return None
    current_id = t.get("assignee_id")
    deadline = schedule.parse_day(t["deadline"])
    today = date.today()
    moved = {**t, "status": "Assigned"}

    def shifts(before: list, after: list) -> list[dict]:
        b = {s.ticket_id: s for s in before}
        titles = {x["id"]: x["title"] for x in repo.get_tickets()}
        out = []
        for s in after:
            if s.ticket_id == ticket_id or s.ticket_id not in b:
                continue
            p0, p1 = b[s.ticket_id].p_miss, s.p_miss
            if abs(p1 - p0) >= 0.01:
                out.append({"ticket_id": s.ticket_id, "title": titles.get(s.ticket_id, f"#{s.ticket_id}"),
                            "deadline": s.deadline.isoformat(), "p_miss_before": p0, "p_miss_after": p1,
                            "crosses": p1 >= ALERT_THRESHOLD and p0 < ALERT_THRESHOLD})
        return sorted(out, key=lambda r: -(r["p_miss_after"] - r["p_miss_before"]))

    current = None
    if current_id:
        before = schedule.analyst_queue(current_id)
        now = next((s for s in before if s.ticket_id == ticket_id), None)
        after = schedule.analyst_queue(current_id, exclude={ticket_id})
        current = {"analyst_id": current_id, "name": (repo.get_analyst(current_id) or {}).get("name"),
                   "p_miss_now": now.p_miss if now else None, "relief": shifts(before, after)}

    options = []
    for c in candidates(t):
        if c.analyst_id == current_id:
            continue
        analyst = repo.get_analyst(c.analyst_id) or {}
        before = schedule.analyst_queue(c.analyst_id)
        after = schedule.analyst_queue(c.analyst_id, extra_ticket=moved)
        slot = next(s for s in after if s.ticket_id == ticket_id)
        affected = shifts(before, after)
        leave = sorted(d.isoformat() for d in schedule.leave_days(c.analyst_id) if today <= d <= deadline)
        harms = any(a["crosses"] for a in affected)
        if slot.p_miss >= ALERT_THRESHOLD:
            verdict, note = "no", f"Still {round(slot.p_miss * 100)}% likely to miss with {c.name}"
        elif harms:
            n = sum(a["crosses"] for a in affected)
            verdict, note = "harms", f"Puts {n} of {c.name}'s own ticket{'s' if n != 1 else ''} at risk"
        elif slot.p_miss >= 0.3 or leave:
            verdict, note = "tight", ("Has leave before the deadline" if leave else "Fits, but with little slack")
        else:
            verdict, note = "good", "Fits without putting anything else at risk"
        options.append({**c.dict(), "weekly_hours": analyst.get("weekly_hours"),
                        "p_miss_if_moved": slot.p_miss, "expected_completion": slot.finish.isoformat() if slot.finish else None,
                        "leave_days": leave, "affected": affected, "verdict": verdict, "verdict_note": note})
    rank = {"good": 0, "tight": 1, "harms": 2, "no": 3}
    options.sort(key=lambda o: (rank[o["verdict"]], o["p_miss_if_moved"], -o["fit"]))
    return {"ticket_id": ticket_id, "title": t["title"], "deadline": t["deadline"],
            "threshold": ALERT_THRESHOLD, "current": current, "options": options}
