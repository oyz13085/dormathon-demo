"""
Replay: the test period's tickets in arrival order through four policies.

  actual         what really happened (real assignee, real close time)
  round_robin    assign by turn
  fewest_open    analyst with the fewest open tickets
  fairqueue      usual partner first, fit score + thresholds, load penalty

Simulator: each analyst works their queue in arrival order for FOCUS hours per
working day. FOCUS is calibrated on the training period only, so the simulated
"actual" policy reproduces real missed deadlines (simulator check). The training
period is replayed first so every policy starts the test period with real queues.

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
from collections import defaultdict
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from fairqueue.config import ALERT_THRESHOLD, HANDOVER_BUFFER_HOURS, ARTIFACTS_DIR
from fairqueue.data.history import load_history, split
from fairqueue.engine.schedule import p_miss

WEIGHTS = {"skill": 0.35, "track": 0.20, "pairing": 0.15, "capacity": 0.15, "deadline": 0.15}


def add_work(start: datetime, hours: float, focus: float) -> datetime:
    """Datetime when `hours` of focused work starting at `start` is done."""
    t = start
    remaining = hours
    for _ in range(2000):
        if t.weekday() >= 5:
            t = (t + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            continue
        if remaining <= focus:
            return t + timedelta(hours=remaining * 8 / focus)   # spread over the working day
        remaining -= focus
        t = (t + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    return t


def work_hours_between(start: datetime, end: datetime, focus: float) -> float:
    if end <= start:
        return 0.0
    days = np.busday_count(start.date(), end.date())
    return float(days) * focus + (focus if end.weekday() < 5 else 0) * 0.5


class Sim:
    def __init__(self, analysts, train, focus, predict, weights=None):
        self.analysts = analysts
        self.focus = focus
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
        if partner in scored and scored[partner][0] >= self.w["poor_fit"]:
            return partner
        return max(scored, key=lambda a: scored[a][1])

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
            ho = handover_model(r, self.exp[(a, r.category)]) if handover_model else 0.0
            hours = base + ho * HANDOVER_BUFFER_HOURS
        start = max(self.free_at[a] or now, now)
        finish = add_work(start, max(hours, 0.25), self.focus)
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

    def predict(r):
        key = (r.category, r.priority, r.division)
        if key not in cache:
            p = predict_hours(r.category, r.priority, r.division, str(r.created_at))
            cache[key] = (p["low"], p["likely"], p["high"])
        return cache[key]

    def handover_model(r, experience):
        return predict_handover(r.category, r.priority, r.division, experience)

    weights = _settings()

    def sim(f: float, warm: bool = True) -> Sim:
        x = Sim(analysts, train, f, predict, weights)
        if warm:
            x.warmup(train)
        return x

    # Calibrate focus hours on the training period only: the value whose simulated
    # close times best match the real close times (median absolute error in hours)
    focus, best = 6.0, None
    for f in np.arange(3.0, 8.01, 0.25):
        out = sim(float(f), warm=False).run("actual", train, handover_model)
        gap = float(np.median([abs((o["finish"] - c).total_seconds()) / 3600
                               for o, c in zip(out, train["closed_at"])]))
        if best is None or gap < best:
            focus, best = float(f), gap

    n_days = int(np.busday_count(test["created_at"].min().date(), test["created_at"].max().date())) + 1
    results = {}
    for policy in ("actual", "round_robin", "fewest_open", "fairqueue"):
        results[policy] = _summary(sim(focus).run(policy, test, handover_model), n_days)
    results["fairqueue_conservative"] = _summary(
        sim(focus).run("fairqueue", test, handover_model, conservative=True), n_days)

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
        "analysts": analysts, "focus_hours_per_day": focus, "weights": weights,
        "assumptions": [
            "Deadlines are service targets: 1.5 × the median duration for each priority.",
            f"Analysts work {focus:g} focused hours per working day (calibrated on the training period).",
            "A ticket given to a different analyst costs that analyst's measured effort on the category.",
            f"Each expected handover adds {HANDOVER_BUFFER_HOURS:g}h.",
        ],
        "policies": results,
        "checks": {
            "simulator": {"real_missed": real_missed,
                          "simulated_missed": results["actual"]["missed_deadlines"],
                          "real_handovers_per_100": real_handovers,
                          "calibration_median_close_error_hours": round(best or 0, 1),
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
