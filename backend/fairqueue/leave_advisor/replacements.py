"""
Eligibility and capacity checks for replacement analysts. The backend's word on whether a handover fits.

A colleague is eligible for a ticket if they're active, aren't the leave requester, and have working time
before the ticket's deadline (approved leave and configured holidays taken out). A handover fits if, with the
ticket added to their real queue (plus handover overhead and any other takeovers in the same plan), the ticket
makes its deadline and none of their own tickets is pushed over the risk threshold.

The figures given to the AI and to the analyst are permitted ones only: skills, similar experience, domain
familiarity, workload, capacity and availability. No track record, revision rates or partnership scores.
"""
from __future__ import annotations
from datetime import date
from fairqueue.config import ALERT_THRESHOLD, HANDOVER_BUFFER_HOURS
from fairqueue.db import repo
from fairqueue.engine import schedule
from fairqueue.leave_advisor import impact
from fairqueue.leave_advisor.impact import PRIORITY_WEIGHT, risk_level


def _history():
    by_cat, by_div = {}, {}
    for t in repo.closed_ticket_history():
        a = t["assignee_id"]
        by_cat[(a, t["category"])] = by_cat.get((a, t["category"]), 0) + 1
        by_div[(a, t["division"])] = by_div.get((a, t["division"]), 0) + 1
    return by_cat, by_div


def moved_item(row: dict) -> dict:
    """The ticket as it would sit in a colleague's queue: remaining work plus handover overhead."""
    r, it = row["remaining"], row["_item"]
    return {"id": row["ticket_id"], "deadline": row["deadline"], "status": "Assigned", "priority": row["priority"],
            "low": round(it["low"] + HANDOVER_BUFFER_HOURS, 1), "likely": round(r["likely"] + HANDOVER_BUFFER_HOURS, 1),
            "high": round(r["high"] + HANDOVER_BUFFER_HOURS, 1)}


class Context:
    """Colleagues, their real queues, and the takeovers accepted so far in this plan."""

    def __init__(self, leave_analyst_id: int, today: date, holidays: set[date], handovers: dict[int, int]):
        self.today = today
        self.colleagues = {a["id"]: a for a in repo.get_analysts() if a["id"] != leave_analyst_id}
        self.by_cat, self.by_div = _history()
        self.off = {aid: schedule.leave_days(aid) | holidays for aid in self.colleagues}
        self.items = {aid: impact.queue_items(aid, handovers) for aid in self.colleagues}
        self.baseline = {aid: impact.simulate(a, self.items[aid], self.off[aid], today) for aid, a in self.colleagues.items()}
        self.pending = {aid: repo.get_leave(analyst_id=aid, status="Requested") for aid in self.colleagues}
        self.takeovers: dict[int, list[dict]] = {aid: [] for aid in self.colleagues}

    def eligible(self, row: dict) -> list[int]:
        dl = schedule.parse_day(row["deadline"])
        out = []
        for aid, a in self.colleagues.items():
            per_day = float(a.get("weekly_hours") or 40) / 5
            if schedule.working_hours(self.today, dl, self.off[aid], per_day) > 0:
                out.append(aid)
        return out

    def profile(self, aid: int, row: dict) -> dict:
        a = self.colleagues[aid]
        skills = [s.strip() for s in (a.get("skills") or "").split(",") if s.strip()]
        cat, div = row["category"], row["division"]
        return {"analyst_id": aid, "name": a["name"], "role": a.get("role_title"), "declared_skills": skills,
                "lists_this_type": (cat or "").lower() in (s.lower() for s in skills),
                "closed_tickets_of_this_type": self.by_cat.get((aid, cat), 0),
                "closed_tickets_for_this_department": self.by_div.get((aid, div), 0),
                "closed_tickets_total": sum(n for (x, _), n in self.by_cat.items() if x == aid)}

    def capacity(self, aid: int, row: dict, extra: list[dict] | None = None) -> dict:
        """The check for one ticket with this colleague's accepted takeovers (and `extra`) already in their queue."""
        a, moved = self.colleagues[aid], moved_item(row)
        prior = self.takeovers[aid] + [x for x in (extra or []) if x["id"] != moved["id"]]
        sim = impact.simulate(a, self.items[aid] + prior + [moved], self.off[aid], self.today)
        slot = sim[moved["id"]]
        knock_on = [tid for tid, s in sim.items() if tid in self.baseline[aid]
                    and s.p_miss >= ALERT_THRESHOLD and self.baseline[aid][tid].p_miss < ALERT_THRESHOLD]
        weekly = float(a.get("weekly_hours") or 40)
        booked_now = sum(i["likely"] for i in self.items[aid] + prior)
        dl = schedule.parse_day(row["deadline"])
        pending = any(schedule.parse_day(l["start_date"]) <= dl and self.today <= schedule.parse_day(l["end_date"])
                      for l in self.pending[aid])
        per_day = float(a.get("weekly_hours") or 40) / 5
        return {"analyst_id": aid, "booked_hours_now": round(booked_now, 1),
                "working_hours_before_deadline": round(schedule.working_hours(self.today, dl, self.off[aid], per_day), 1),
                "booked_hours_after": round(booked_now + moved["likely"], 1), "weekly_hours": weekly,
                "hours_ahead_in_queue": slot.hours_before,       # earlier-deadline work they'd do first
                "handover_overhead_hours": HANDOVER_BUFFER_HOURS,
                "finish_if_taken": slot.finish.isoformat() if slot.finish else None,
                "deadline_risk_if_taken": risk_level(slot.p_miss),
                "deadline_chance": round(1 - slot.p_miss, 2),
                "meets_deadline": slot.p_miss < ALERT_THRESHOLD,
                "own_tickets_pushed_at_risk": len(knock_on),
                "fits": slot.p_miss < ALERT_THRESHOLD and not knock_on,
                "may_be_unavailable": pending}            # pending leave overlaps; dates and reasons never shown

    def accept(self, aid: int, row: dict) -> None:
        self.takeovers[aid].append(moved_item(row))

    def suitability(self, aid: int, row: dict, cap: dict) -> dict:
        """A rule-based 0–100 score from permitted parts only (impact.CONFIG["suitability_weights"]). A part with no
        data (e.g. nobody has done this ticket type) is shown as None and left out of the average."""
        p = self.profile(aid, row)
        cat, div = row["category"], row["division"]
        most = lambda table, key: max([n for (a, k), n in table.items() if k == key and a in self.colleagues] or [0])
        exp_max, dom_max = most(self.by_cat, cat), most(self.by_div, div)
        need = moved_item(row)["likely"]
        free = cap["working_hours_before_deadline"] - cap["hours_ahead_in_queue"]
        adj = repo.get_skill_deltas(aid).get(cat, 0.0)
        values = {
            "skills": max(0.0, min((1.0 if p["lists_this_type"] else 0.0) + adj, 1.0)),
            "experience": p["closed_tickets_of_this_type"] / exp_max if exp_max else None,
            "domain": p["closed_tickets_for_this_department"] / dom_max if dom_max else None,
            "capacity": max(0.0, min(free / need, 1.0)) if need else None,
            "deadline": cap["deadline_chance"],
        }
        weights = impact.CONFIG["suitability_weights"]
        used = {k: v for k, v in values.items() if v is not None}
        score = round(100 * sum(weights[k] * v for k, v in used.items()) / sum(weights[k] for k in used)) if used else None
        return {"score": score, "method": "rule-based",
                "parts": [{"key": k, "label": PART_LABELS[k], "value": None if v is None else round(v, 2),
                           "weight": weights[k]} for k, v in values.items()],
                "skills": {"declared": p["declared_skills"], "lists_this_type": p["lists_this_type"]},
                "experience": {"closed_this_type": p["closed_tickets_of_this_type"],
                               "closed_for_department": p["closed_tickets_for_this_department"],
                               "closed_total": p["closed_tickets_total"]},
                "capacity": {k: cap[k] for k in ("booked_hours_now", "booked_hours_after", "hours_ahead_in_queue",
                                                 "working_hours_before_deadline", "handover_overhead_hours",
                                                 "finish_if_taken", "fits", "own_tickets_pushed_at_risk")}}


PART_LABELS = {"skills": "Skills match", "experience": "Similar ticket experience", "domain": "Domain familiarity",
               "capacity": "Available capacity", "deadline": "Deadline feasibility"}


def by_urgency(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (-PRIORITY_WEIGHT[r["priority"]], r["deadline"]))


def rule_based_pick(row: dict, ctx: Context) -> tuple[int | None, str]:
    """The labelled fallback when the AI is unavailable: the colleague who fits, ranked by similar experience,
    listed skill and then the most free hours. No made-up scores."""
    fits = []
    for aid in ctx.eligible(row):
        cap = ctx.capacity(aid, row)
        if cap["fits"] and not cap["may_be_unavailable"]:
            p = ctx.profile(aid, row)
            fits.append(((p["closed_tickets_of_this_type"], p["lists_this_type"], cap["weekly_hours"] - cap["booked_hours_after"]), p, cap))
    if not fits:
        return None, "No colleague can take this on and still meet the deadline."
    _, p, cap = max(fits, key=lambda f: f[0])
    reason = (f"{p['closed_tickets_of_this_type']} closed {row['category']} tickets"
              + (f", lists {row['category']} as a skill" if p["lists_this_type"] else "")
              + f"; with {cap['hours_ahead_in_queue']:g}h of earlier-deadline work ahead of it and "
              f"{cap['working_hours_before_deadline']:g}h of working time before the deadline, could finish around "
              f"{impact._fmt(cap['finish_if_taken'])}.")
    return p["analyst_id"], reason
