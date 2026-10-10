"""
Replay: the test period's tickets in arrival order through four policies.

  actual         what really happened (real assignee, real close time)
  round_robin    assign by turn
  fewest_open    analyst with the fewest open tickets
  fairqueue      best risk-adjusted fit: fit score − load penalty − deadline-risk penalty
                 (+ a small nudge for the usual partner), the same rule as the live app

Simulator: each analyst works their queue in arrival order. Focus hours vary from
day to day (meetings, interruptions): each analyst-day draws from a normal with a
calibrated mean and spread. Both are calibrated on the training period only, so the
simulated "actual" policy can be checked against real missed deadlines in the test
period (simulator check). Every policy sees the same analyst-days (common random
numbers), results are averaged over several runs, and the training period is
replayed first so every policy starts the test period with real queues.
Policies decide with the mean focus only: nobody knows tomorrow's interruptions.
A handover also costs waiting time (effort is active time, the deadline is elapsed time):
the ticket and its analyst's queue wait WAIT days, also calibrated on the training period.

A ticket costs its real hours for the real assignee. Given to someone else, the hours
are scaled by that analyst's measured effort on the category in the training period
(relative to the real assignee's, shrunk toward 1), and the handover model's
probability × handover buffer is added (expected handovers). This is an assumption:
the replay can't observe how long someone else would really have taken.

Validity checks:
  1. Simulator check   simulated vs real missed deadlines for the real assignments
  2. Agreement check   real miss rate where the real assignee matched FairQueue's pick vs not
  3. Conservative      FairQueue gains counted only where its pick had done this type before
"""
from __future__ import annotations
import json
import zlib
from collections import defaultdict
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from fairqueue.config import ALERT_THRESHOLD, HANDOVER_BUFFER_HOURS, ARTIFACTS_DIR
from fairqueue.data.history import load_history, split
from fairqueue.engine.schedule import p_miss
from fairqueue.engine.fit import risk_adjusted

WEIGHTS = {"skill": 0.35, "track": 0.20, "pairing": 0.15, "capacity": 0.15, "deadline": 0.15}
RUNS = 12                     # simulator runs averaged per policy (same analyst-days for every policy)


def day_focus(mean: float, spread: float, seed: int, analyst: str, day) -> float:
    """Focus hours for one analyst on one day. Deterministic, so every policy sees the same day."""
    if spread <= 0:
        return mean
    key = zlib.crc32(f"{seed}|{analyst}|{day.toordinal()}".encode())
    return float(np.clip(np.random.default_rng(key).normal(mean, spread), 1.0, 9.0))


def add_work(start: datetime, hours: float, focus, used: dict | None = None) -> datetime:
    """When `hours` of focused work starting at `start` is done. `focus(date)` gives that day's hours;
    `used` (date -> hours already worked) makes one day's focus a budget shared by every ticket."""
    used = {} if used is None else used
    t = start
    remaining = hours
    for _ in range(4000):
        if t.weekday() >= 5:
            t = (t + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            continue
        f = focus(t.date())
        left = f - used.get(t.date(), 0.0)
        if left <= 1e-9:
            t = (t + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            continue
        step = min(remaining, left)
        used[t.date()] = used.get(t.date(), 0.0) + step
        t = t + timedelta(hours=step * 8 / f)                   # the day's focus is spread over 8 working hours
        remaining -= step
        if remaining <= 1e-9:
            return t
        t = (t + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    return t


def work_hours_between(start: datetime, end: datetime, focus: float) -> float:
    if end <= start:
        return 0.0
    days = np.busday_count(start.date(), end.date())
    return float(days) * focus + (focus if end.weekday() < 5 else 0) * 0.5


class Sim:
    def __init__(self, analysts, train, focus, predict, weights=None, spread=0.0, seed=0, wait=0.0):
        self.analysts = analysts
        self.focus = focus              # mean focus hours: what policies plan with
        self.spread, self.seed = spread, seed
        self.wait = wait                # waiting days per handover
        self.used = defaultdict(dict)   # analyst -> {date: focus hours already worked}
        self.predict = predict          # (row) -> (low, likely, high)
        self.w = weights or {**WEIGHTS, "good_fit": 70, "poor_fit": 50}
        self.free_at = {a: None for a in analysts}
        self.open = defaultdict(list)   # analyst -> finish times of open tickets
        self.exp = defaultdict(int)     # (analyst, category) -> tickets done
        self.pair = defaultdict(int)    # (analyst, requester) -> tickets done
        self.err = defaultdict(list)    # (analyst, category) -> |actual-pred|/pred
        self.rr = 0
        cat_med = train.groupby("category")["actual_hours"].median()
        ratios = defaultdict(list)
        for r in train.itertuples():
            pred = cat_med.get(r.category, r.actual_hours)
            self.err[(r.assignee, r.category)].append(abs(r.actual_hours - pred) / max(pred, 0.5))
            ratios[(r.assignee, r.category)].append(r.actual_hours / max(pred, 0.5))
        self.eff = {k: (sum(v) + 3) / (len(v) + 3) for k, v in ratios.items()}
        partner = train.groupby(["requester", "assignee"]).size().reset_index(name="n")
        self.partner = partner.sort_values("n").groupby("requester").last()["assignee"].to_dict()

    def warmup(self, rows):
        for r in rows.itertuples():
            self.step("actual", r)
        self.rr = 0

    def backlog(self, a, now):
        start = max(self.free_at[a] or now, now)
        return work_hours_between(now, start, self.focus)

    def n_open(self, a, now):
        self.open[a] = [f for f in self.open[a] if f > now]
        return len(self.open[a])

    def fit(self, a, r, now, loads_avg):
        low, likely, high = self.predict(r)
        most = max([self.exp[(x, r.category)] for x in self.analysts] or [0])
        skill = self.exp[(a, r.category)] / most if most else 0
        errs = self.err[(a, r.category)]
        track = max(0.0, 1 - min(float(np.mean(errs)), 1)) if errs else 0.5
        pairing = min(self.pair[(a, r.requester)] / 20, 1)
        backlog = self.backlog(a, now)
        capacity = min(max(self.focus * 5 - backlog, 0) / high, 1) if high else 1
        avail = work_hours_between(now, r.deadline, self.focus) - backlog
        deadline = 1 - p_miss(max(avail, 0), low, likely, high)
        w = self.w
        s = 100 * (w["skill"] * skill + w["track"] * track + w["pairing"] * pairing
                   + w["capacity"] * capacity + w["deadline"] * deadline)
        penalty = min(10, 10 * (backlog - loads_avg) / loads_avg) if loads_avg and backlog > loads_avg else 0
        return s, s - penalty

    def pick(self, policy, r, now):
        if policy == "actual":
            return r.assignee
        if policy == "round_robin":
            a = self.analysts[self.rr % len(self.analysts)]
            self.rr += 1
            return a
        if policy == "fewest_open":
            return min(self.analysts, key=lambda a: (self.n_open(a, now), self.analysts.index(a)))
        loads = [self.backlog(a, now) for a in self.analysts]
        avg = sum(loads) / len(loads)
        scored = {a: self.fit(a, r, now, avg) for a in self.analysts}
        partner = self.partner.get(r.requester)
        # Same rule as the live recommendation card (engine/fit.py)
        return max(self.analysts, key=lambda a: risk_adjusted(
            scored[a][0], scored[a][0] - scored[a][1], self.p_miss_for(a, r, now), a == partner))

    def p_miss_for(self, a, r, now):
        low, likely, high = self.predict(r, a)
        avail = max(work_hours_between(now, r.deadline, self.focus) - self.backlog(a, now), 0)
        return p_miss(avail, low, likely, high)

    def step(self, policy, r, handover_model=None, conservative=False):
        now = r.created_at
        a = self.pick(policy, r, now)
        if conservative and self.exp[(a, r.category)] == 0:
            a = r.assignee                       # no credit where the pick had no history on this type
        low, likely, high = self.predict(r)
        backlog = self.backlog(a, now)
        avail = max(work_hours_between(now, r.deadline, self.focus) - backlog, 0)
        p = p_miss(avail, low, likely, high)

        hours = r.actual_hours
        ho = float(r.handovers > 0)
        if a != r.assignee:
            base = hours - (HANDOVER_BUFFER_HOURS if r.handovers else 0)
            base *= self.eff.get((a, r.category), 1.0) / self.eff.get((r.assignee, r.category), 1.0)
            ho = handover_model(r, self.exp[(a, r.category)], a) if handover_model else 0.0
            hours = base + ho * HANDOVER_BUFFER_HOURS
        start = max(self.free_at[a] or now, now)
        finish = add_work(start, max(hours, 0.25), lambda d: day_focus(self.focus, self.spread, self.seed, a, d), self.used[a])
        finish += timedelta(days=ho * self.wait)            # waiting for the next analyst to pick it up
        self.free_at[a] = finish
        self.open[a].append(finish)
        self.exp[(a, r.category)] += 1
        self.pair[(a, r.requester)] += 1
        return {"ticket_id": r.ticket_id, "division": r.division, "category": r.category,
                "analyst": a, "hours": hours, "week": now.isocalendar()[:2],
                "finish": finish, "deadline": r.deadline, "missed": finish > r.deadline,
                "handover": ho, "alert": p >= ALERT_THRESHOLD, "p_miss": p,
                "cause_ok": _cause_check(r, backlog, avail, low, likely, high)}

    def run(self, policy, rows, handover_model, conservative=False):
        return [self.step(policy, r, handover_model, conservative) for r in rows.itertuples()]


def _cause_check(r, backlog, avail, low, likely, high) -> bool:
    """Was the cause label we'd have shown right in hindsight?"""
    if backlog > avail:                              # label: Overloaded assignee
        return backlog > r.actual_hours
    if r.actual_hours > high:                        # label: Underestimated type
        return True
    return r.actual_hours > avail                    # label: Tight deadline


def _summary(rows, n_days):
    df = pd.DataFrame(rows)
    weekly = df.groupby(["week", "analyst"])["hours"].sum().unstack(fill_value=0)
    spread = float((weekly.max(axis=1) - weekly.min(axis=1)).mean())
    alerts = df[df["alert"]]
    precision = float(alerts["missed"].mean()) if len(alerts) else 0.0
    recall = float(df[df["missed"]]["alert"].mean()) if df["missed"].any() else 0.0
    missed_alerts = alerts[alerts["missed"]]
    cause_acc = float(missed_alerts["cause_ok"].mean()) if len(missed_alerts) else 0.0
    return {
        "missed_deadlines": int(df["missed"].sum()),
        "missed_pct": round(100 * df["missed"].mean(), 1),
        "handovers_per_100": round(100 * df["handover"].sum() / len(df), 1),
        "workload_spread_hours": round(spread, 1),
        "alert_precision": round(precision, 2),
        "alert_recall": round(recall, 2),
        "alerts_per_day": round(len(alerts) / max(n_days, 1), 2),
        "cause_label_accuracy": round(cause_acc, 2),
        "by_department": {d: int(g["missed"].sum()) for d, g in df.groupby("division")},
    }


def _settings() -> dict:
    """Use the lead's current fit weights and thresholds, so the sliders show up in the replay."""
    try:
        from fairqueue.db import repo
        w = repo.get_fit_settings()
        return {"skill": w["w_skill"], "track": w["w_track"], "pairing": w["w_pairing"],
                "capacity": w["w_capacity"], "deadline": w["w_deadline"],
                "good_fit": w["good_fit"], "poor_fit": w["poor_fit"]}
    except Exception:
        return {**WEIGHTS, "good_fit": 70, "poor_fit": 50}


def run_replay() -> dict:
    df, source = load_history()
    train, test = split(df)
    analysts = sorted(df["assignee"].unique().tolist())

    from fairqueue.models.hours import predict_hours
    from fairqueue.models.handover import predict_handover
    cache: dict = {}

    def predict(r, analyst=None):
        """Hours for a ticket; with an analyst, adjusted for their measured speed on the type."""
        key = (r.category, r.priority, r.division, analyst)
        if key not in cache:
            p = predict_hours(r.category, r.priority, r.division, str(r.created_at), analyst)
            cache[key] = (p["low"], p["likely"], p["high"])
        return cache[key]

    def handover_model(r, experience, analyst=None):
        return predict_handover(r.category, r.priority, r.division, experience, analyst)

    weights = _settings()

    def sim(f: float, spread: float = 0.0, seed: int = 0, warm: bool = True, wait: float | None = None) -> Sim:
        x = Sim(analysts, train, f, predict, weights, spread, seed, wait_days if wait is None else wait)
        if warm:
            x.warmup(train)
        return x

    # Calibrate on the training period only: mean focus, day-to-day spread and handover waiting
    # are chosen so the simulated real assignments reproduce the real close times (median
    # absolute error), with the training miss count as a tie-breaker. The test period is never used.
    train_missed = int((train["closed_at"] > train["deadline"]).sum())
    focus, spread, wait_days, best, best_err = 6.0, 0.0, 0.0, None, 0.0
    for f in np.arange(3.0, 8.01, 0.5):
        for sd in (0.0, 1.0, 2.0):
            for wd in (0.0, 0.5, 1.0, 1.5, 2.0):
                runs = [sim(float(f), sd, seed, warm=False, wait=wd).run("actual", train, handover_model) for seed in range(3)]
                miss_gap = abs(float(np.mean([sum(o["missed"] for o in out) for out in runs])) - train_missed)
                err = float(np.median([abs((o["finish"] - c).total_seconds()) / 3600
                                       for o, c in zip(runs[0], train["closed_at"])]))
                # Close times first (one error per ticket, far more information than one count);
                # the training miss count only breaks near-ties
                score = err + 0.1 * miss_gap
                if best is None or score < best:
                    focus, spread, wait_days, best, best_err = float(f), sd, wd, score, err

    n_days = int(np.busday_count(test["created_at"].min().date(), test["created_at"].max().date())) + 1

    def averaged(policy: str, conservative: bool = False) -> dict:
        runs = [_summary(sim(focus, spread, seed).run(policy, test, handover_model, conservative), n_days)
                for seed in range(RUNS)]
        out = {k: round(float(np.mean([r[k] for r in runs])), 2) for k in runs[0] if k != "by_department"}
        out["missed_deadlines"] = round(out["missed_deadlines"], 1)
        out["missed_range"] = [min(r["missed_deadlines"] for r in runs), max(r["missed_deadlines"] for r in runs)]
        out["by_department"] = {d: round(float(np.mean([r["by_department"].get(d, 0) for r in runs])), 1)
                                for d in runs[0]["by_department"]}
        return out

    results = {}
    for policy in ("actual", "round_robin", "fewest_open", "fairqueue"):
        results[policy] = averaged(policy)
    results["fairqueue_conservative"] = averaged("fairqueue", conservative=True)

    # Validity checks
    real_missed = int((test["closed_at"] > test["deadline"]).sum())
    real_handovers = round(100 * float((test["handovers"] > 0).mean()), 1)
    agree_sim = sim(focus)
    agree, disagree = [], []
    for r in test.itertuples():
        pick = agree_sim.pick("fairqueue", r, r.created_at)
        (agree if pick == r.assignee else disagree).append(r.closed_at > r.deadline)
        agree_sim.step("actual", r)

    report_path = ARTIFACTS_DIR / "model_report.json"
    model_report = json.loads(report_path.read_text()) if report_path.exists() else None

    return {
        "data_source": source,
        "data_note": ("Synthetic history generated for the demo. These numbers show the pipeline works; "
                      "they are not evidence. Put the Mendeley CSV in backend/data/raw/ and rerun.")
                     if source == "synthetic" else "Real ticket history (Mendeley Help Desk Tickets).",
        "n_train": int(len(train)), "n_test": int(len(test)),
        "test_period": [str(test["created_at"].min().date()), str(test["created_at"].max().date())],
        "analysts": analysts, "focus_hours_per_day": focus, "focus_spread_hours": spread, "runs": RUNS,
        "handover_wait_days": wait_days,
        "weights": weights,
        "assumptions": [
            "Deadlines are service targets: 1.5 × the median duration for each priority.",
            f"Analysts average {focus:g} focused hours a working day, varying by about ±{spread:g}h day to day "
            f"(both calibrated on the training period only). Results are the mean of {RUNS} runs.",
            "A ticket given to a different analyst costs that analyst's measured effort on the category.",
            f"Each expected handover adds {HANDOVER_BUFFER_HOURS:g}h of work and {wait_days:g} day(s) of waiting (calibrated).",
        ],
        "policies": results,
        "checks": {
            "simulator": {"real_missed": real_missed,
                          "simulated_missed": results["actual"]["missed_deadlines"],
                          "real_handovers_per_100": real_handovers,
                          "calibration_median_close_error_hours": round(best_err, 1),
                          "passes": abs(results["actual"]["missed_deadlines"] - real_missed) <= max(3, 0.25 * real_missed)},
            "agreement": {"n_matched": len(agree), "n_not_matched": len(disagree),
                          "missed_pct_when_matched": round(100 * float(np.mean(agree)), 1) if agree else None,
                          "missed_pct_when_not": round(100 * float(np.mean(disagree)), 1) if disagree else None},
            "conservative": {"fairqueue_missed": results["fairqueue"]["missed_deadlines"],
                             "conservative_missed": results["fairqueue_conservative"]["missed_deadlines"]},
        },
        "hours_model": model_report["hours"] if model_report else None,
        "handover_model": model_report["handover"] if model_report else None,
    }
