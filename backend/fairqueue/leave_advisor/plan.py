"""
Handover suggestions for the Request leave modal.

  1. Deterministic: validate the dates, find affected tickets, work out who's eligible (impact.py, replacements.py)
  2. AI (Groq): picks one colleague (or none) per ticket through read-only tools (agent.py)
  3. Deterministic: every pick is re-checked, most urgent ticket first, with each accepted takeover added to that
     colleague's queue, so the same capacity can't be promised twice

If the AI is unavailable, step 2 is replaced by a separately labelled rule-based pick. Results are cached briefly
per analyst, dates and data, so the modal doesn't call the API on every change.
"""
from __future__ import annotations
import hashlib
import json
import time
from datetime import date
from fairqueue.db import repo
from fairqueue.leave_advisor import agent, impact, store
from fairqueue.leave_advisor.replacements import Context, by_urgency, rule_based_pick

MAX_TEXT = 300
_cache: dict[str, tuple[float, dict]] = {}
# The AI's last picks per analyst and dates, kept apart from the data fingerprint: after a handover the data
# changes, and the remaining picks are re-validated against it instead of calling the AI again
_picks: dict[str, tuple[float, dict, dict]] = {}


# ── Deterministic stage ────────────────────────────────────────────────────────

def _affected(a: dict) -> list[dict]:
    """Tickets the leave affects that can't simply be finished before it starts."""
    return by_urgency([r for r in a["rows"] if r["affected"] and not r["fits_before_leave"]])


def _ticket_facts(r: dict, ctx: Context) -> dict:
    return {"ticket_id": r["ticket_id"], "title": r["title"], "category": r["category"], "division": r["division"],
            "priority": r["priority"], "status": r["status"], "deadline": r["deadline"], "timing": r["timing"],
            "remaining_work": r["remaining"]["label"], "remaining_known": not r["remaining"]["uncertain"],
            "blocked_waiting_on_requester": r["remaining"]["blocked"],
            "eligible_analyst_ids": ctx.eligible(r)}           # Waiting tickets can be handed over too


def dispatcher(rows: dict[int, dict], ctx: Context):
    """The four read-only tools. Unknown IDs raise, which the agent returns to the model as a tool error."""
    def ticket(tid) -> dict:
        if tid not in rows:
            raise ValueError(f"Ticket {tid} isn't one of the affected tickets")
        return rows[tid]

    def colleague(aid, r) -> int:
        if aid not in ctx.eligible(r):
            raise ValueError(f"Analyst {aid} isn't eligible for ticket {r['ticket_id']}")
        return aid

    def dispatch(name: str, args: dict) -> dict:
        if name == "get_affected_tickets":
            return {"tickets": [_ticket_facts(r, ctx) for r in rows.values()]}
        r = ticket(args.get("ticket_id"))
        if name == "get_eligible_analysts":
            return {"ticket_id": r["ticket_id"], "analysts": [
                {"analyst_id": aid, "name": ctx.colleagues[aid]["name"], "role": ctx.colleagues[aid].get("role_title")}
                for aid in ctx.eligible(r)]}
        aid = colleague(args.get("analyst_id"), r)
        if name == "get_analyst_skills_and_experience":
            return ctx.profile(aid, r)
        if name == "get_analyst_capacity":
            from fairqueue.leave_advisor.replacements import moved_item
            extra = [moved_item(rows[t]) for t in args.get("also_taking") or [] if t in rows and t != r["ticket_id"]]
            return ctx.capacity(aid, r, extra)
        raise ValueError(f"Unknown tool {name}")
    return dispatch


def _candidates(r: dict, ctx: Context) -> list[dict]:
    """Each eligible colleague's records for one ticket, pre-loaded so the model needs few tool calls (and few
    tokens). The same figures the tools return, trimmed to what a choice needs."""
    out = []
    for aid in ctx.eligible(r):
        p, c = ctx.profile(aid, r), ctx.capacity(aid, r)
        out.append({"analyst_id": aid, "name": p["name"], "role": p["role"],
                    "lists_this_type_as_a_declared_skill": p["lists_this_type"],
                    "closed_tickets_of_this_type": p["closed_tickets_of_this_type"],
                    "closed_tickets_for_this_department": p["closed_tickets_for_this_department"],
                    "open_work_hours_now": c["booked_hours_now"],
                    "earlier_deadline_hours_ahead_of_it": c["hours_ahead_in_queue"],
                    "could_finish_by": c["finish_if_taken"], "fits": c["fits"],
                    "may_be_unavailable": c["may_be_unavailable"]})
    return out


def _context(a: dict, rows: list[dict], ctx: Context) -> str:
    tickets = [{**_ticket_facts(r, ctx), "candidates": _candidates(r, ctx)} for r in rows]
    facts = {"leave_requester": a["analyst"]["name"], "leave": {"from": a["start"].isoformat(), "to": a["end"].isoformat()},
             "affected_tickets": tickets}
    return ("Choose a handover for each affected ticket below. Each ticket lists its eligible colleagues with their "
            "records; \"fits\" is the capacity check for that ticket alone. If you give one colleague more than one "
            "ticket, call get_analyst_capacity with the others in also_taking to check the combined workload. "
            "Otherwise you can answer without tools.\n\n" + json.dumps(facts, separators=(",", ":")))


# ── Validating the picks ───────────────────────────────────────────────────────

def _short(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= MAX_TEXT else text[: MAX_TEXT - 1].rstrip() + "…"


def validate_choices(rows: list[dict], picks: dict[int, dict], ctx: Context, source: str) -> list[dict]:
    """Accept a pick (from the AI or the fallback) only if the colleague is eligible and, with every takeover accepted before it, still fits."""
    out = []
    for r in rows:                                              # most urgent first
        pick = picks.get(r["ticket_id"]) or {}
        aid, reason, status = pick.get("analyst_id"), _short(pick.get("reason")), source
        suit = None                                             # computed before accepting, so it isn't double-counted
        if aid is not None:
            if aid not in ctx.colleagues or aid not in ctx.eligible(r):
                aid, status, reason = None, "rejected", "The suggested colleague isn't eligible for this ticket."
            else:
                cap = ctx.capacity(aid, r)
                if cap["fits"]:
                    suit = ctx.suitability(aid, r, cap)
                    ctx.accept(aid, r)
                else:
                    name = ctx.colleagues[aid]["name"]
                    aid, status = None, "rejected"
                    reason = (f"{name} was suggested, but with the other proposed handovers they wouldn't meet this "
                              "deadline. Team Lead review required.")
                    if source == "ai":                      # offer a checked, clearly labelled alternative
                        alt, alt_reason = rule_based_pick(r, ctx)
                        if alt is not None:
                            suit = ctx.suitability(alt, r, ctx.capacity(alt, r))
                            ctx.accept(alt, r)
                            aid, status = alt, "rule_based"
                            reason = (f"The AI suggested {name}, but with its other proposed handovers they wouldn't "
                                      f"meet this deadline. Rule-based alternative: {alt_reason}")
        if aid is None and status not in ("blocked", "rejected"):
            reason = "No suitable replacement found. Team Lead review required." + (f" {reason}" if reason else "")
        chosen = ctx.colleagues.get(aid) if aid is not None else None
        out.append({
            "ticket_id": r["ticket_id"], "title": r["title"], "deadline": r["deadline"], "priority": r["priority"],
            "status": r["status"], "impact": _short(pick.get("impact")) or impact.why(r, r["_start"], r["_end"]),
            "recommended": {"id": aid, "name": chosen["name"], "role": chosen.get("role_title")} if chosen else None,
            "suitability": suit if chosen else None,
            "reason": reason, "decided_by": status,
            "handover_feasible": ("unknown" if r["remaining"]["uncertain"] else "yes") if chosen else "no",
        })
    return out


# ── Everything together ────────────────────────────────────────────────────────

def _fingerprint(analyst_id: int) -> str:
    """Changes whenever tickets, assignees, estimates, leave or analysts change, so a stale answer isn't reused."""
    data = [(t["id"], t["assignee_id"], t["status"], t["deadline"], t["pred_likely"]) for t in repo.get_tickets()]
    data += [(l["id"], l["analyst_id"], l["status"], l["start_date"], l["end_date"]) for l in repo.get_leave()]
    data += [(a["id"], a["weekly_hours"], a["skills"]) for a in repo.get_analysts()]
    return hashlib.sha256(json.dumps(data, default=str).encode()).hexdigest()[:16]


def build(analyst_id: int, start_date: str, end_date: str, hours_left: dict[int, float],
          today: date | None = None, client=None, use_cache: bool = True) -> dict:
    v = impact.validate(analyst_id, start_date, end_date, hours_left, today)
    if not v["valid"]:
        return {"valid": False, "errors": v["errors"], "warnings": v["warnings"], "tickets": []}

    key = json.dumps([analyst_id, start_date, end_date, sorted(hours_left.items()), str(today), _fingerprint(analyst_id)])
    hit = _cache.get(key)
    if use_cache and hit and time.time() - hit[0] < float(impact.CONFIG["ai"]["cache_ttl_seconds"]):
        return {**hit[1], "cached": True}

    a = impact.analyse(analyst_id, v["start"], v["end"], hours_left, today)
    rows = _affected(a)
    for r in rows:
        r["_start"], r["_end"] = a["start"], a["end"]
    ctx = Context(analyst_id, a["today"], a["holidays"], a["handovers"])
    ai = {"status": "not_needed", "provider": impact.CONFIG["ai"].get("provider", "groq"), "reason": None,
          "model": None, "request_ids": [], "turns": 0}

    if not rows:
        tickets, source = [], "none_needed"
    elif all(not ctx.eligible(r) for r in rows):
        # Nothing to choose: nobody is eligible for any affected ticket, so the AI isn't asked
        ai["reason"] = "No affected ticket can be handed over, so the AI wasn't needed."
        tickets, source = validate_choices(rows, {}, ctx, "rule_based"), "none_needed"
    elif not impact.CONFIG["ai"].get("enabled", True):
        ai["status"], ai["reason"] = "disabled", "The AI agent is turned off in advisor_config.yaml."
        tickets, source = _fallback(rows, ctx), "rule_based"
    else:
        pkey = json.dumps([analyst_id, start_date, end_date, sorted(hours_left.items()), str(today)])
        prev = _picks.get(pkey)
        fresh = prev and time.time() - prev[0] < float(impact.CONFIG["ai"]["cache_ttl_seconds"])
        if use_cache and fresh and {r["ticket_id"] for r in rows} <= set(prev[1]):
            # Same leave, fewer tickets (e.g. after a handover): re-check the earlier AI picks against today's data
            ai.update(prev[2])
            ai["reused"] = True
            tickets, source = validate_choices(rows, prev[1], ctx, "ai"), "ai"
        else:
            result = agent.run(_context(a, rows, ctx), dispatcher({r["ticket_id"]: r for r in rows}, ctx), client=client)
            if isinstance(result, agent.AgentResult):
                picks = {d.affected_ticket_id: {"analyst_id": d.recommended_analyst_id, "reason": d.short_recommendation_reason,
                                                "impact": d.short_impact_explanation} for d in result.answer.decisions}
                ai.update(status="ok", model=result.model, request_ids=result.request_ids, turns=result.turns)
                _picks[pkey] = (time.time(), picks, dict(ai))
                tickets, source = validate_choices(rows, picks, ctx, "ai"), "ai"
            else:
                ai.update(status="unavailable", reason=result.reason, request_ids=result.request_ids)
                tickets, source = _fallback(rows, ctx), "rule_based"
    _enrich(tickets, {r["ticket_id"]: r for r in rows})
    done = [{"ticket_id": h["ticket_id"], "title": h["title"], "priority": h["priority"], "deadline": h["deadline"],
             "to": {"id": h["to_analyst_id"], "name": h["to_name"], "role": h["to_role"]},
             "still_with_them": h["assignee_id"] == h["to_analyst_id"], "decided_by_ai": bool(h["decided_by_ai"]),
             "at": h["created_at"]} for h in store.handovers_from(analyst_id, start_date, end_date)]

    out = {"valid": True, "errors": [], "warnings": v["warnings"],
           "leave": {"start_date": start_date, "end_date": end_date,
                     "return_date": impact.add_working_days(a["end"], 1, a["base_off"]).isoformat()},
           "calendar": a["calendar"], "source": source, "ai": ai, "tickets": tickets,
           "stats": _stats(tickets, done), "reassigned": done,
           "note": "Reassign hands a ticket over now. The Team Lead still approves the leave itself.", "cached": False}
    _cache[key] = (time.time(), out)
    return out


URGENCY = ("Critical", "High", "Medium", "Low")


def _enrich(tickets: list[dict], rows: dict[int, dict]) -> None:
    """Add the figures the ticket cards show, all from records already computed. Official deadlines never change:
    a later date is only ever shown as a proposed revised deadline."""
    timings = {"during_leave": " while you're away", "after_return": " soon after you return",
               "before_leave": " before your leave", "later": ""}
    for t in tickets:
        r = rows[t["ticket_id"]]
        fin = r["finish_with_leave"]
        late = bool(fin and fin > r["deadline"])
        kept = (f" If you keep it, it would finish around {impact._fmt(fin)}, after the deadline." if late
                else " If you keep it, it should still make the deadline." if fin else "")
        t["urgency"] = {"level": r["priority"], "risk": r["risk"]["level"],
                        "why": f"{r['priority']} priority, due {impact._fmt(r['deadline'])}{timings[r['timing']]}.{kept}"}
        cap = (t.get("suitability") or {}).get("capacity")
        t["projected_completion"] = cap["finish_if_taken"] if cap else None     # if reassigned to the recommended colleague
        t["projected_if_kept"] = fin
        candidate = t["projected_completion"] if t["recommended"] else fin
        t["proposed_revised_deadline"] = candidate if candidate and candidate > r["deadline"] else None
        # The deadline to suggest: the original one if the forecast still meets it, the forecast date if not,
        # and None (shown as a dash) when there's no reliable forecast. The official deadline never changes here
        t["suggested_deadline"] = (max(candidate, r["deadline"]) if candidate else None)
        t["team_effect"] = ({"colleague": t["recommended"]["name"], "hours_now": cap["booked_hours_now"],
                             "hours_after": cap["booked_hours_after"],
                             "extra_hours": round(cap["booked_hours_after"] - cap["booked_hours_now"], 1),
                             "their_tickets_pushed_at_risk": cap["own_tickets_pushed_at_risk"]} if cap else None)
    tickets.sort(key=lambda t: (URGENCY.index(t["priority"]) if t["priority"] in URGENCY else 9, t["deadline"]))


def _stats(tickets: list[dict], done: list[dict]) -> dict:
    with_rec = [t for t in tickets if t["recommended"]]
    extra: dict[str, float] = {}
    for t in with_rec:
        e = t["team_effect"]
        extra[e["colleague"]] = round(extra.get(e["colleague"], 0) + e["extra_hours"], 1)
    return {"affected": len(tickets), "reassigned": len(done),
            "by_urgency": {u: sum(1 for t in tickets if t["priority"] == u) for u in URGENCY},
            "urgent_handovers": sum(1 for t in with_rec if t["priority"] in ("Critical", "High")),
            "extra_team_hours": round(sum(extra.values()), 1), "extra_hours_by_colleague": extra,
            "at_risk_if_kept": sum(1 for t in tickets if t["urgency"]["risk"] == "High"),
            "without_replacement": len(tickets) - len(with_rec)}


def _fallback(rows: list[dict], ctx: Context) -> list[dict]:
    picks = {}
    for r in rows:
        aid, reason = rule_based_pick(r, ctx)
        picks[r["ticket_id"]] = {"analyst_id": aid, "reason": reason}
        if aid is not None:
            ctx.accept(aid, r)                         # so the next rule-based pick sees this takeover
    for aid in ctx.takeovers:                          # validate_choices re-adds them in urgency order
        ctx.takeovers[aid] = []
    return validate_choices(rows, picks, ctx, "rule_based")
