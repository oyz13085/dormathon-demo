"""
Queue arithmetic shared by deadline risk, the fit score's deadline part, the
what-if check and expected completion dates.

Each analyst works their open tickets in deadline order, HOURS_PER_DAY on working
days, skipping approved leave (and any hypothetical leave passed in). A ticket's
available hours = working hours left before its deadline minus the hours of the
tickets queued ahead of it. Comparing that with the ticket's low / likely / high
estimate gives the chance of missing the deadline:

    available ≥ high            → 0.05
    likely ≤ available < high   → 0.10 – 0.50
    low ≤ available < likely    → 0.50 – 0.90
    available < low             → 0.95
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from fairqueue.config import HOURS_PER_DAY, HANDOVER_BUFFER_HOURS
from fairqueue.db import repo

OPEN_ASSIGNED = ("Assigned", "In progress", "Waiting")


def parse_day(s: str) -> date:
    return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def leave_days(analyst_id: int, extra: list[tuple[str, str]] | None = None,
               ignore_leave_id: int | None = None) -> set[date]:
    days: set[date] = set()
    for l in repo.get_leave(analyst_id=analyst_id, status="Approved"):
        if l["id"] == ignore_leave_id:
            continue
        days.update(daterange(parse_day(l["start_date"]), parse_day(l["end_date"])))
    for s, e in extra or []:
        days.update(daterange(parse_day(s), parse_day(e)))
    return days


def working_hours(start: date, end: date, off: set[date], per_day: float = HOURS_PER_DAY) -> float:
    if end < start:
        return 0.0
    return sum(per_day for d in daterange(start, end) if d.weekday() < 5 and d not in off)


def p_miss(available: float, low: float, likely: float, high: float) -> float:
    if available >= high:
        return 0.05
    if available >= likely:
        return round(0.10 + 0.40 * (high - available) / max(high - likely, 0.1), 2)
    if available >= low:
        return round(0.50 + 0.40 * (likely - available) / max(likely - low, 0.1), 2)
    return 0.95


def finish_date(start: date, hours_before: float, hours: float, off: set[date],
                per_day: float = HOURS_PER_DAY) -> date:
    """Day the ticket would finish if hours_before of earlier work comes first."""
    need = hours_before + hours
    d = start
    for _ in range(366):
        if d.weekday() < 5 and d not in off:
            need -= per_day
            if need <= 0:
                return d
        d += timedelta(days=1)
    return d


@dataclass
class Slot:
    ticket_id: int
    analyst_id: int | None
    deadline: date
    low: float
    likely: float
    high: float
    hours_before: float = 0.0
    available: float = 0.0
    p_miss: float = 0.0
    finish: date | None = None
    leave_hours_lost: float = 0.0
    handover_buffer: float = 0.0
    queue_ahead: list[int] = field(default_factory=list)


def ticket_hours(t: dict, handovers: int = 0) -> tuple[float, float, float, float]:
    from fairqueue.models.hours import predict_hours_rules
    if t.get("pred_likely") is None:
        p = predict_hours_rules(t.get("category") or "", t.get("priority") or "Medium")
        low, likely, high = p["low"], p["likely"], p["high"]
    else:
        low, likely, high = t["pred_low"] or t["pred_likely"], t["pred_likely"], t["pred_high"] or t["pred_likely"]
    buffer = HANDOVER_BUFFER_HOURS * handovers
    return low + buffer, likely + buffer, high + buffer, buffer


def analyst_queue(analyst_id: int, extra_leave: list[tuple[str, str]] | None = None,
                  extra_ticket: dict | None = None, exclude: set[int] | None = None,
                  today: date | None = None, ignore_leave_id: int | None = None) -> list[Slot]:
    """Schedule one analyst's open tickets (plus an optional hypothetical one)."""
    today = today or date.today()
    analyst = repo.get_analyst(analyst_id) or {}
    per_day = float(analyst.get("weekly_hours") or 40) / 5
    off = leave_days(analyst_id, extra_leave, ignore_leave_id)
    off_no_leave: set[date] = set()
    handovers = repo.handover_counts()

    tickets = [t for t in repo.get_tickets(assignee_id=analyst_id) if t["status"] in OPEN_ASSIGNED
               and t["id"] not in (exclude or set())]
    if extra_ticket:
        tickets.append(extra_ticket)
    tickets.sort(key=lambda t: (t["deadline"], 0 if t.get("status") == "In progress" else 1, t["id"]))

    slots, before, ahead = [], 0.0, []
    for t in tickets:
        low, likely, high, buf = ticket_hours(t, handovers.get(t["id"], 0))
        dl = parse_day(t["deadline"])
        cap = working_hours(today, dl, off, per_day)
        cap_no_leave = working_hours(today, dl, off_no_leave, per_day)
        avail = max(cap - before, 0.0)
        s = Slot(ticket_id=t["id"], analyst_id=analyst_id, deadline=dl, low=low, likely=likely,
                 high=high, hours_before=before, available=avail,
                 p_miss=p_miss(avail, low, likely, high),
                 finish=finish_date(today, before, likely, off, per_day),
                 leave_hours_lost=cap_no_leave - cap, handover_buffer=buf,
                 queue_ahead=list(ahead))
        slots.append(s)
        before += likely
        ahead.append(t["id"])
    return slots


def unassigned_slot(t: dict, today: date | None = None) -> Slot:
    today = today or date.today()
    low, likely, high, buf = ticket_hours(t)
    dl = parse_day(t["deadline"])
    avail = working_hours(today, dl, set())
    return Slot(ticket_id=t["id"], analyst_id=None, deadline=dl, low=low, likely=likely, high=high,
                available=avail, p_miss=p_miss(avail, low, likely, high), finish=None)


def full_schedule(extra_leave: dict[int, list[tuple[str, str]]] | None = None) -> dict[int, Slot]:
    """Every open ticket → its slot."""
    out: dict[int, Slot] = {}
    for a in repo.get_analysts():
        for s in analyst_queue(a["id"], (extra_leave or {}).get(a["id"])):
            out[s.ticket_id] = s
    for t in repo.get_tickets(status="Unassigned"):
        out[t["id"]] = unassigned_slot(t)
    return out


def open_hours(analyst_id: int) -> float:
    return sum(ticket_hours(t)[1] for t in repo.get_tickets(assignee_id=analyst_id)
               if t["status"] in OPEN_ASSIGNED)
