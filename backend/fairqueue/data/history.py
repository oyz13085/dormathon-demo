"""
Historical tickets for model training and the replay.

Source, in order:
  1. Real data: any CSV in data/raw/ (the Mendeley Help Desk Tickets export).
     Column names come from config.yaml (history.columns). Each project is mapped
     to one of the four departments through data/department_map.csv, which is
     generated (roughly balanced, illustrative) the first time it is needed.
  2. Synthetic: if data/raw/ is empty, a deterministic synthetic history is
     generated so the pipeline runs end to end. Everything built on it is
     labelled "synthetic" — those numbers are not evidence.

Standard columns returned:
  ticket_id, created_at, closed_at, deadline, category, priority, division,
  assignee, requester, actual_hours, handovers
"""
from __future__ import annotations
import csv
import random
from datetime import datetime, timedelta, date
from pathlib import Path
import numpy as np
import pandas as pd
from fairqueue.config import DATA_DIR, HISTORY, SERVICE_TARGET_MULTIPLIER, DEPARTMENTS

RAW_DIR = DATA_DIR / "raw"
DEPT_MAP = DATA_DIR / "department_map.csv"

_cache: dict[str, object] = {}


def load_history() -> tuple[pd.DataFrame, str]:
    """Returns (dataframe, source) where source is 'mendeley' or 'synthetic'."""
    if "df" in _cache:
        return _cache["df"], _cache["source"]  # type: ignore[return-value]
    files = sorted(RAW_DIR.glob("*.csv"))
    if files:
        df, source = _load_real(files), "mendeley"
    else:
        df, source = generate_synthetic(), "synthetic"
    df = _add_deadlines(df)
    df = df.sort_values("created_at").reset_index(drop=True)
    _cache["df"], _cache["source"] = df, source
    return df, source


def split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Time-based split: the last test_fraction of tickets (by arrival) is the test period."""
    cut = int(len(df) * (1 - float(HISTORY.get("test_fraction", 0.3))))
    return df.iloc[:cut].copy(), df.iloc[cut:].copy()


def _add_deadlines(df: pd.DataFrame) -> pd.DataFrame:
    """No deadline in the data: service target per priority = multiplier × median duration."""
    if "deadline" in df.columns and df["deadline"].notna().all():
        return df
    dur_days = (df["closed_at"] - df["created_at"]).dt.total_seconds() / 86400
    medians = dur_days.groupby(df["priority"]).median()
    target = df["priority"].map(medians).fillna(dur_days.median()) * SERVICE_TARGET_MULTIPLIER
    df = df.copy()
    df["deadline"] = df["created_at"] + pd.to_timedelta(target.clip(lower=1), unit="D")
    return df


# ── Real data ──────────────────────────────────────────────────────────────────

def _load_real(files: list[Path]) -> pd.DataFrame:
    cols = HISTORY["columns"]
    raw = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    rename = {v: k for k, v in cols.items() if v in raw.columns}
    missing = [k for k in ("created_at", "closed_at", "category", "priority") if k not in rename.values()]
    if missing:
        raise ValueError(
            f"data/raw CSV is missing columns for {missing}. "
            f"Set history.columns in config.yaml to the real column names. Found: {list(raw.columns)}"
        )
    df = raw.rename(columns=rename)
    df["created_at"] = pd.to_datetime(df["created_at"], errors="coerce")
    df["closed_at"] = pd.to_datetime(df["closed_at"], errors="coerce")
    df = df.dropna(subset=["created_at", "closed_at"])
    df = df[df["closed_at"] >= df["created_at"]].copy()

    if "effort_hours" in df.columns and df["effort_hours"].notna().any():
        df["actual_hours"] = pd.to_numeric(df["effort_hours"], errors="coerce")
    else:
        # No effort column: working hours between open and close, capped at one week of work
        days = (df["closed_at"] - df["created_at"]).dt.total_seconds() / 86400
        df["actual_hours"] = (days * 8 * 5 / 7).clip(0.5, 40)
    df = df[df["actual_hours"] > 0]

    df["priority"] = df["priority"].map(_normalise_priority)
    source_col = "project" if "project" in df.columns else "category"
    df["division"] = df[source_col].astype(str).map(_department_map(df[source_col].astype(str).unique()))
    if "assignee" not in df.columns:
        df["assignee"] = "Unknown"
    df["assignee"] = df["assignee"].astype(str)
    df["requester"] = df.get("requester", df["division"] + " requester")
    df["handovers"] = pd.to_numeric(df.get("handovers", 0), errors="coerce").fillna(0).astype(int)
    if "ticket_id" not in df.columns:
        df["ticket_id"] = range(1, len(df) + 1)
    df["category"] = df["category"].astype(str)
    return df[["ticket_id", "created_at", "closed_at", "category", "priority", "division",
               "assignee", "requester", "actual_hours", "handovers"]]


def _normalise_priority(v) -> str:
    s = str(v).strip().lower()
    for p, keys in (("Critical", ("crit", "1", "p1", "urgent", "blocker")),
                    ("High", ("high", "2", "p2", "major")),
                    ("Low", ("low", "4", "p4", "minor", "trivial"))):
        if s in keys or s.startswith(keys[0]):
            return p
    return "Medium"


def _department_map(values) -> dict[str, str]:
    """Read data/department_map.csv; add any unmapped value, balancing departments."""
    mapping: dict[str, str] = {}
    if DEPT_MAP.exists():
        with open(DEPT_MAP, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("source") and row.get("department") in DEPARTMENTS:
                    mapping[row["source"]] = row["department"]
    counts = {d: sum(1 for v in mapping.values() if v == d) for d in DEPARTMENTS}
    changed = False
    for v in sorted(values):
        if v not in mapping:
            dept = min(DEPARTMENTS, key=lambda d: counts[d])
            mapping[v] = dept
            counts[dept] += 1
            changed = True
    if changed:
        with open(DEPT_MAP, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["source", "department"])
            for k in sorted(mapping):
                w.writerow([k, mapping[k]])
    return mapping


# ── Synthetic history ──────────────────────────────────────────────────────────

# Demo analysts and what they are actually good at (drives true effort in the synthetic data)
SYN_ANALYSTS = {
    "Aiman":    {"Automation", "Dashboards", "Reporting", "Modelling", "Documentation"},  # generalist
    "Mei Ling": {"Reporting", "Automation"},          # finance reporting
    "Ravi":     {"Modelling", "Documentation"},       # HR data
    "Sarah":    {"Dashboards", "Modelling"},          # marketing analytics
    "Jun Wei":  {"Automation", "Reporting"},          # junior
}
SYN_REQUESTERS = {
    "Finance":   ["Nurul Huda", "Daniel Tan"],
    "HR":        ["Priya Nair", "Hafiz Rahman"],
    "IT":        ["Kevin Lim"],
    "Marketing": ["Aisha Zainal", "Chloe Wong"],
}
USUAL_PARTNER = {"Finance": "Mei Ling", "HR": "Ravi", "IT": "Aiman", "Marketing": "Sarah"}
CATEGORY_MIX = {
    "Finance":   {"Reporting": 0.7, "Automation": 0.15, "Modelling": 0.15},
    "HR":        {"Modelling": 0.35, "Reporting": 0.35, "Documentation": 0.3},
    "IT":        {"Automation": 0.5, "Dashboards": 0.3, "Reporting": 0.2},
    "Marketing": {"Dashboards": 0.4, "Reporting": 0.3, "Modelling": 0.3},
}
BASE_HOURS = {"Reporting": 5.5, "Modelling": 11.0, "Automation": 5.0, "Dashboards": 6.0, "Documentation": 3.5}
PRIORITY_MULT = {"Low": 0.8, "Medium": 1.0, "High": 1.2, "Critical": 1.4}


def _weekday(d: datetime) -> bool:
    return d.weekday() < 5


def generate_synthetic(weeks: int = 26, seed: int = 7) -> pd.DataFrame:
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    end = datetime.combine(date.today() - timedelta(days=7), datetime.min.time())
    start = end - timedelta(weeks=weeks)

    rows = []
    day = start
    while day < end:
        if _weekday(day):
            for dept in DEPARTMENTS:
                rate = 0.45
                if dept == "Finance" and day.day >= 24:
                    rate = 1.3                      # month-end spike
                if dept == "HR" and (20 <= day.day <= 26 or day.month in (3, 9)):
                    rate = 0.8                      # payroll run and appraisal season
                if dept == "Marketing" and day.isocalendar()[1] % 6 in (0, 1):
                    rate = 0.8                      # pre-launch fortnight
                for _ in range(np_rng.poisson(rate)):
                    rows.append(_synthetic_ticket(rng, np_rng, dept, day))
        day += timedelta(days=1)

    df = pd.DataFrame(rows).sort_values("created_at").reset_index(drop=True)
    df["ticket_id"] = range(1, len(df) + 1)
    df = _simulate_history_closures(df, rng)
    return df


def _synthetic_ticket(rng, np_rng, dept, day) -> dict:
    cats = CATEGORY_MIX[dept]
    category = rng.choices(list(cats), weights=list(cats.values()))[0]
    priority = rng.choices(["Low", "Medium", "High", "Critical"], weights=[0.25, 0.4, 0.27, 0.08])[0]
    requester = rng.choice(SYN_REQUESTERS[dept])
    # What actually happened: usual partner most of the time, otherwise whoever was free-ish
    assignee = USUAL_PARTNER[dept] if rng.random() < 0.7 else rng.choice(list(SYN_ANALYSTS))
    skilled = category in SYN_ANALYSTS[assignee]
    effect = (0.85 if skilled else 1.35) * (1.15 if assignee == "Jun Wei" else 1.0)
    hours = BASE_HOURS[category] * PRIORITY_MULT[priority] * effect * float(np_rng.lognormal(0, 0.4))
    handovers = 1 if rng.random() < (0.25 if not skilled else 0.05) else 0
    if handovers:
        hours += rng.uniform(1.0, 3.0)  # time lost re-learning the context
    created = day + timedelta(hours=rng.uniform(8, 17))
    return {"created_at": created, "category": category, "priority": priority, "division": dept,
            "requester": requester, "assignee": assignee, "actual_hours": round(hours, 1),
            "handovers": handovers}


def _simulate_history_closures(df: pd.DataFrame, rng: random.Random) -> pd.DataFrame:
    """Closures for the synthetic history: each analyst works their queue in arrival order
    with a randomly varying 4-8 focus hours a day (meetings, interruptions). One budget per
    analyst per day, shared by every ticket they touch that day."""
    free_at: dict[str, datetime] = {}
    budget: dict[str, tuple[date, float, float]] = {}   # analyst -> (day, hours left, hours that day)
    closed = []
    for _, t in df.iterrows():
        a = t["assignee"]
        cursor = max(free_at.get(a, t["created_at"]), t["created_at"])
        remaining = float(t["actual_hours"])
        while remaining > 1e-9:
            if not _weekday(cursor):
                cursor = (cursor + timedelta(days=1)).replace(hour=9, minute=0)
                continue
            day, left, total = budget.get(a, (None, 0.0, 0.0))
            if day != cursor.date():
                total = rng.uniform(4, 8)
                day, left = cursor.date(), total
            if left <= 1e-9:
                cursor = (cursor + timedelta(days=1)).replace(hour=9, minute=0)
                continue
            used = min(remaining, left)
            remaining -= used
            left -= used
            budget[a] = (day, left, total)
            cursor = cursor + timedelta(hours=used * 8 / total)   # the day's focus is spread over 8 working hours
            if remaining > 1e-9:
                cursor = (cursor + timedelta(days=1)).replace(hour=9, minute=0)
        if t["handovers"]:
            cursor += timedelta(days=1)  # waiting for the next analyst to pick it up
        free_at[a] = cursor
        closed.append(cursor)
    df = df.copy()
    df["closed_at"] = closed
    return df
