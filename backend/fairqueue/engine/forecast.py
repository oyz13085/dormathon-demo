"""
Volume forecast: ticket hours per week for the next two weeks, team-wide and per
department, against the team's available hours.

Per department: usual weekly hours = median of the last 12 weeks outside its busy
season; busy-season weeks are multiplied by the seasonal factor learned from the
same 12 weeks (busy-season mean ÷ usual). Busy seasons come from the KPI documents:
Finance month-end, HR payroll run and appraisal season, Marketing pre-launch
fortnights, IT rollout weeks. Demand for a week = forecast new work + open work
already due that week. Capacity = analysts' working days that week minus approved leave.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta
from statistics import median
from fairqueue.config import DEPARTMENTS, HOURS_PER_DAY
from fairqueue.db import repo
from fairqueue.engine import schedule

HISTORY_WEEKS = 12
SPIKE_FACTOR = 1.3

SEASON_REASON = {
    "Finance": "Finance month-end close", "HR": "HR payroll / appraisal period",
    "Marketing": "Marketing campaign launch", "IT": "IT system rollout",
}


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def in_season(dept: str, wk: date) -> bool:
    days = [wk + timedelta(days=i) for i in range(5)]
    if dept == "Finance":
        return any(d.day >= 24 for d in days)
    if dept == "HR":
        return any(20 <= d.day <= 26 or d.month in (3, 9) for d in days)
    if dept == "Marketing":
        return wk.isocalendar()[1] % 6 in (0, 1)
    return False   # IT rollouts are announced, not calendar-driven


def _weekly_history() -> dict[str, dict[date, float]]:
    out: dict[str, dict[date, float]] = {d: {} for d in DEPARTMENTS}
    this_week = week_start(date.today())
    first = this_week - timedelta(weeks=HISTORY_WEEKS)
    for t in repo.get_tickets(include_history=True):
        created = datetime.fromisoformat(str(t["created_at"])[:19]).date()
        wk = week_start(created)
        if first <= wk < this_week:
            hours = t.get("actual_hours") or t.get("pred_likely") or 0
            out[t["division"]][wk] = out[t["division"]].get(wk, 0) + hours
    return out


def _dept_model(hist: dict[date, float], dept: str) -> tuple[float, float]:
    this_week = week_start(date.today())
    weeks = [this_week - timedelta(weeks=i) for i in range(1, HISTORY_WEEKS + 1)]
    usual = [hist.get(w, 0) for w in weeks if not in_season(dept, w)]
    busy = [hist.get(w, 0) for w in weeks if in_season(dept, w)]
    base = median(usual) if usual else 0.0
    factor = (sum(busy) / len(busy)) / base if busy and base else 1.0
    return base, max(factor, 1.0)


def _capacity(wk: date) -> float:
    total = 0.0
    for a in repo.get_analysts():
        off = schedule.leave_days(a["id"])
        per_day = float(a.get("weekly_hours") or 40) / 5
        start = max(wk, date.today())
        total += schedule.working_hours(start, wk + timedelta(days=4), off, per_day)
    return total


def forecast(n_weeks: int = 2, division: str | None = None) -> dict:
    hist = _weekly_history()
    models = {d: _dept_model(hist[d], d) for d in DEPARTMENTS}
    open_t = [t for t in repo.get_tickets() if t["status"] != "Closed"]
    today = date.today()
    first_week = week_start(today) if today.weekday() < 5 else week_start(today) + timedelta(weeks=1)
    weeks = []
    for i in range(n_weeks):
        wk = first_week + timedelta(weeks=i)
        wk_end = wk + timedelta(days=6)
        depts = {}
        for d in DEPARTMENTS:
            base, factor = models[d]
            season = in_season(d, wk)
            new = base * (factor if season else 1.0)
            if wk <= today:
                new *= (5 - today.weekday()) / 5            # only the rest of this week
            due = sum(schedule.ticket_hours(t)[1] for t in open_t if t["division"] == d and
                      (schedule.parse_day(t["deadline"]) <= wk_end if i == 0 else wk <= schedule.parse_day(t["deadline"]) <= wk_end))
            depts[d] = {"hours": round(new + due), "new_work": round(new), "due_open_work": round(due),
                        "usual": round(base), "season": season,
                        "spike": season and factor >= SPIKE_FACTOR,
                        "reason": SEASON_REASON[d] if season else None}
        demand = sum(v["hours"] for k, v in depts.items() if not division or k == division)
        cap = round(_capacity(wk))
        spikes = [d for d, v in depts.items() if v["spike"] and (not division or d == division)]
        label = f"Week of {wk.strftime('%d %b')}"
        if division:
            msg = (f"{label}: {division} needs about {demand}h"
                   + (f", above its usual {depts[division]['usual']}h ({SEASON_REASON[division]} spike)." if division in spikes else "."))
        elif demand > cap:
            msg = f"{label} needs {demand} hours, the team has {cap}." + (f" {', '.join(SEASON_REASON[d] for d in spikes)} spike." if spikes else "")
        else:
            msg = f"{label} needs {demand} hours of the team's {cap}." + (f" Watch: {', '.join(SEASON_REASON[d] for d in spikes)}." if spikes else "")
        weeks.append({"week_start": wk.isoformat(), "label": label, "demand_hours": demand,
                      "capacity_hours": cap, "over_capacity": demand > cap,
                      "departments": depts, "spikes": spikes, "message": msg})
    return {"weeks": weeks, "method": "seasonal baseline from last 12 weeks per department"}


def spike_divisions() -> dict[str, str]:
    wk = forecast(1)["weeks"][0]
    return {d: f"{wk['departments'][d]['hours']}h forecast this week vs usual {wk['departments'][d]['usual']}h"
            for d in wk["spikes"]}
