"""
Leave impact: which of an analyst's active tickets the requested leave puts at risk, and why.

Everything here is deterministic. It reuses the shared schedule's building blocks (working hours,
finish dates, chance of missing, approved leave) without changing them, and adds:

  • remaining work that isn't assumed to equal the original estimate (see remaining())
  • configured public holidays, used only once they're marked verified
  • a queue simulation that can hold several hypothetical tickets at once, so capacity isn't double-counted
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
import yaml
from fairqueue.config import ALERT_THRESHOLD, DATA_DIR
from fairqueue.db import repo
from fairqueue.engine import schedule

CONFIG = yaml.safe_load(Path(__file__).with_name("advisor_config.yaml").read_text(encoding="utf-8"))
ACTIVE = schedule.OPEN_ASSIGNED                      # Assigned, In progress, Waiting
PRIORITY_WEIGHT = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}
MAX_HOURS_LEFT = 500


def risk_level(p: float) -> str:
    return "High" if p >= ALERT_THRESHOLD else "Medium" if p >= 0.3 else "Low"


# ── Calendar ───────────────────────────────────────────────────────────────────

def holidays() -> tuple[set[date], dict]:
    """Verified public holidays for the configured locations, or none (and a label saying so)."""
    cal = CONFIG["calendar"]
    locations = list(cal.get("locations") or [])
    if not cal.get("verified"):
        return set(), {"configured": False, "label": "Public holidays not configured",
                       "detail": "Dates count working weekdays only; they don't account for public holidays.",
                       "locations": locations}
    wanted = {l.lower() for l in locations}
    days = set()
    for h in cal.get("holidays") or []:
        where = {l.lower() for l in h.get("locations") or ["all"]}
        if "all" in where or where & wanted:
            days.add(schedule.parse_day(h["date"]))
    return days, {"configured": True, "label": f"Includes verified public holidays for {', '.join(locations)}",
                  "detail": f"Source: {cal.get('source') or 'not recorded'}.", "locations": locations}


def working_days(start: date, end: date, off: set[date]) -> int:
    return sum(1 for d in schedule.daterange(start, end) if d.weekday() < 5 and d not in off)


def add_working_days(start: date, n: int, off: set[date]) -> date:
    d, left = start, n
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5 and d not in off:
            left -= 1
    return d


# ── Validation ─────────────────────────────────────────────────────────────────

def _day(s: str) -> date | None:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def validate(analyst_id: int, start_date: str, end_date: str, hours_left: dict[int, float],
             today: date | None = None) -> dict:
    today = today or date.today()
    errors, warnings = [], []
    analyst = repo.get_analyst(analyst_id)
    if not analyst or not analyst.get("active"):
        errors.append("Unknown or inactive analyst.")
    start, end = _day(start_date), _day(end_date)
    if start is None or end is None:
        errors.append("Use dates in the form YYYY-MM-DD.")
    else:
        if end < start:
            errors.append("The leave ends before it starts.")
        if start < today:
            errors.append("Leave can't start in the past.")
        if analyst and not errors:
            for l in repo.get_leave(analyst_id=analyst_id):
                if l["status"] in ("Requested", "Approved") and \
                        schedule.parse_day(l["start_date"]) <= end and start <= schedule.parse_day(l["end_date"]):
                    errors.append(f"This overlaps leave you've already {'requested' if l['status'] == 'Requested' else 'had approved'}.")
                    break
        if not errors:
            off, _ = holidays()
            if working_days(start, end, off) == 0:
                warnings.append("These dates don't include any working days.")
    for tid, v in hours_left.items():
        if not (0 <= v <= MAX_HOURS_LEFT):
            errors.append(f"Hours left for ticket #{tid} must be between 0 and {MAX_HOURS_LEFT}.")
    return {"valid": not errors, "errors": errors, "warnings": warnings, "analyst": analyst, "start": start, "end": end}


# ── Remaining work ─────────────────────────────────────────────────────────────

def remaining(t: dict, hours_left: dict[int, float], handovers: dict[int, int]) -> dict:
    """How much work is left. Only an analyst's own figure is treated as known; otherwise the estimate is an
    upper bound (In progress) or the work is blocked (Waiting), and the result is flagged uncertain."""
    low, likely, high, _ = schedule.ticket_hours(t, handovers.get(t["id"], 0))
    if t["status"] == "In progress" and t["id"] in hours_left:
        v = round(float(hours_left[t["id"]]), 1)
        return {"low": v, "likely": v, "high": v, "basis": "self_reported", "uncertain": False, "blocked": False,
                "label": f"{v:g}h left (your estimate)"}
    if t["status"] == "In progress":
        return {"low": low, "likely": likely, "high": high, "basis": "upper_bound", "uncertain": True, "blocked": False,
                "label": f"Up to {likely:g}h: hours left not given, so the full estimate is used as an upper bound"}
    if t["status"] == "Waiting":
        return {"low": low, "likely": likely, "high": high, "basis": "blocked", "uncertain": True, "blocked": True,
                "label": f"About {likely:g}h once unblocked: waiting on the requester"}
    return {"low": low, "likely": likely, "high": high, "basis": "estimate", "uncertain": False, "blocked": False,
            "label": f"About {likely:g}h (not started; the ticket's estimate)"}


# ── Queue simulation ───────────────────────────────────────────────────────────

@dataclass
class Slot:
    ticket_id: int
    deadline: date
    likely: float
    hours_before: float
    available: float
    p_miss: float
    finish: date | None


def simulate(analyst: dict, items: list[dict], off: set[date], today: date, order=None) -> dict[int, Slot]:
    """Work a queue in deadline order (or `order`), like schedule.analyst_queue, but with any number of
    hypothetical tickets. Each item: {id, deadline, status, low, likely, high}."""
    per_day = float(analyst.get("weekly_hours") or 40) / 5
    key = order or (lambda t: (t["deadline"], 0 if t.get("status") == "In progress" else 1, t["id"]))
    out, before = {}, 0.0
    for t in sorted(items, key=key):
        dl = schedule.parse_day(t["deadline"])
        avail = max(schedule.working_hours(today, dl, off, per_day) - before, 0.0)
        out[t["id"]] = Slot(t["id"], dl, t["likely"], round(before, 1), round(avail, 1),
                            schedule.p_miss(avail, t["low"], t["likely"], t["high"]),
                            schedule.finish_date(today, before, t["likely"], off, per_day))
        before += t["likely"]
    return out


def queue_items(analyst_id: int, handovers: dict[int, int], hours_left: dict[int, float] | None = None) -> list[dict]:
    """An analyst's active tickets as queue items. Only the leave requester's own hours-left figures are used;
    colleagues' tickets use their stored estimates."""
    items = []
    for t in repo.get_tickets(assignee_id=analyst_id):
        if t["status"] not in ACTIVE:
            continue
        r = remaining(t, hours_left or {}, handovers) if hours_left is not None else None
        low, likely, high = (r["low"], r["likely"], r["high"]) if r else schedule.ticket_hours(t, handovers.get(t["id"], 0))[:3]
        items.append({"id": t["id"], "deadline": t["deadline"], "status": t["status"], "priority": t["priority"],
                      "low": low, "likely": likely, "high": high})
    return items


# ── Per-ticket impact ──────────────────────────────────────────────────────────

def _kpi_lines(t: dict) -> list[str]:
    """Lines of the requesting department's KPI document that share a KPI word with the ticket."""
    from fairqueue.engine.risk import KPI_WORDS
    path = DATA_DIR / "kpi_docs" / f"{t['division']}.md"
    if not path.exists():
        return []
    text = f"{t['title']} {t.get('description') or ''}".lower()
    words = [w for w in KPI_WORDS if w in text]
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip("-*# 0123456789.").replace("**", "").strip()
        if clean and any(w in clean.lower() for w in words) and clean not in out:
            out.append(clean)
    return out[:2]


def timing(deadline: date, start: date, end: date, off: set[date]) -> str:
    if deadline < start:
        return "before_leave"
    if deadline <= end:
        return "during_leave"
    if working_days(end + timedelta(days=1), deadline, off) <= int(CONFIG["after_return_working_days"]):
        return "after_return"
    return "later"


def analyse(analyst_id: int, start: date, end: date, hours_left: dict[int, float], today: date | None = None) -> dict:
    """The leave analyst's tickets with and without the leave. Replacement choices are added by replacements.py."""
    today = today or date.today()
    analyst = repo.get_analyst(analyst_id)
    handovers = repo.handover_counts()
    hol, calendar = holidays()
    base_off = schedule.leave_days(analyst_id) | hol
    leave_off = base_off | set(schedule.daterange(start, end))
    items = queue_items(analyst_id, handovers, hours_left)
    baseline = simulate(analyst, items, base_off, today)
    with_leave = simulate(analyst, items, leave_off, today)
    per_day = float(analyst.get("weekly_hours") or 40) / 5
    hours_before_leave = schedule.working_hours(today, start - timedelta(days=1), base_off, per_day) if start > today else 0.0

    tickets = {t["id"]: t for t in repo.get_tickets(assignee_id=analyst_id)}
    rows = []
    for it in items:
        t, b, w = tickets[it["id"]], baseline[it["id"]], with_leave[it["id"]]
        r = remaining(t, hours_left, handovers)
        when = timing(w.deadline, start, end, base_off)
        fits_before = (not r["blocked"] and when != "later" and w.finish is not None and w.finish < start
                       and w.hours_before + r["likely"] <= hours_before_leave)
        affected = when in ("during_leave", "after_return") or (w.p_miss >= ALERT_THRESHOLD and w.p_miss > b.p_miss)
        rows.append({
            "ticket_id": t["id"], "title": t["title"], "division": t["division"], "requester": t["requester"],
            "priority": t["priority"], "status": t["status"], "category": t["category"], "deadline": t["deadline"],
            "description": t.get("description"), "timing": when, "affected": affected,
            "remaining": {k: r[k] for k in ("likely", "high", "basis", "uncertain", "blocked", "label")},
            "hours_ahead_in_queue": w.hours_before, "available_hours_before_deadline": w.available,
            "fits_before_leave": fits_before, "finish_with_leave": w.finish.isoformat() if w.finish else None,
            "risk_before": {"p_miss": b.p_miss, "level": risk_level(b.p_miss)},
            "risk": {"p_miss": w.p_miss, "level": risk_level(w.p_miss), "uncertain": r["uncertain"]},
            "kpi_lines": _kpi_lines(t), "_item": it,
        })
    rows.sort(key=lambda x: (not x["affected"], -PRIORITY_WEIGHT[x["priority"]], x["deadline"]))
    return {"analyst": analyst, "today": today, "start": start, "end": end, "calendar": calendar, "holidays": hol,
            "base_off": base_off, "leave_off": leave_off, "hours_before_leave": round(hours_before_leave, 1),
            "handovers": handovers, "items": items, "rows": rows}


# ── Explanations from the figures (no LLM) ─────────────────────────────────────

def _fmt(d: str | date) -> str:
    d = schedule.parse_day(d) if isinstance(d, str) else d
    return d.strftime("%a %d %b")


def why(row: dict, start: date, end: date) -> str:
    r = row["remaining"]
    if r["blocked"]:
        return f"Waiting on {row['requester']}, so it can't move forward until they reply; it's due {_fmt(row['deadline'])}."
    if row["timing"] == "during_leave":
        head = f"Due {_fmt(row['deadline'])}, while you're away ({_fmt(start)} to {_fmt(end)})."
    elif row["timing"] == "after_return":
        head = f"Due {_fmt(row['deadline'])}, soon after you return on {_fmt(add_working_days(end, 1, set()))}."
    elif row["timing"] == "before_leave":
        head = f"Due {_fmt(row['deadline'])}, before your leave starts."
    else:
        head = f"Due {_fmt(row['deadline'])}."
    if row["fits_before_leave"]:
        return head + " It fits in the working time you have before leave."
    return (head + f" It needs {('up to ' if r['uncertain'] else 'about ')}{r['likely']:g}h, with "
            f"{row['hours_ahead_in_queue']:g}h of earlier work ahead of it and {row['available_hours_before_deadline']:g}h "
            "of your working time left before the deadline once the leave is taken out.")


def consequence(row: dict) -> str:
    """Only what the records support: priority, requester, projected lateness and matching KPI-doc lines."""
    parts = [f"{row['priority']} priority request from {row['requester']} ({row['division']})."]
    fin = row["finish_with_leave"]
    if fin and schedule.parse_day(fin) > schedule.parse_day(row["deadline"]):
        parts.append(f"With the leave and no changes, it would finish around {_fmt(fin)}, after the {_fmt(row['deadline'])} deadline.")
    for line in row["kpi_lines"]:
        parts.append(f"Related {row['division']} KPI (from the demo KPI document): \"{line}\"")
    return " ".join(parts)
