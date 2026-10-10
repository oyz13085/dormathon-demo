"""
Leave advisor: affected-ticket detection, the AI handover agent (with a mocked Groq client), backend
validation of the AI's picks, fallbacks, caching, privacy and submission without reassignment.
Every test runs against its own freshly seeded database, with dates relative to today.
Run from backend/:  python tests/test_leave_advisor.py   (or python -m pytest tests -q)
No test calls the real API: GROQ_API_KEY is removed after config loads backend/.env, and Groq is replaced
by FakeGroq.
"""
import copy
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "import.db"))

import groq                                      # noqa: E402
import httpx                                     # noqa: E402  (the HTTP library groq uses)
from fastapi.testclient import TestClient        # noqa: E402
from fairqueue import config                     # noqa: E402,F401  (loads backend/.env)
from fairqueue.db import repo                    # noqa: E402
from fairqueue.db.seed import seed               # noqa: E402
from fairqueue.engine import schedule            # noqa: E402
from fairqueue.leave_advisor import agent, impact, plan  # noqa: E402
from fairqueue.leave_advisor.replacements import Context  # noqa: E402
import main                                      # noqa: E402

os.environ.pop("GROQ_API_KEY", None)             # after backend/.env is loaded, so a real key is never used
client = TestClient(main.app)
MODEL = impact.CONFIG["ai"]["model"]
TODAY = date.today()
START = TODAY + timedelta(days=(7 - TODAY.weekday()) % 7 or 7) + timedelta(days=7)    # a Monday, 1–2 weeks out
END = START + timedelta(days=4)                                                         # that Friday


# ── A fake Groq ────────────────────────────────────────────────────────────────

def completion(message, finish="stop", rid="req_final"):
    return SimpleNamespace(id=f"chatcmpl_{rid}", model=MODEL, x_groq=SimpleNamespace(id=rid),
                           choices=[SimpleNamespace(finish_reason=finish, message=message)])


def text_response(obj, rid="req_final", finish="stop"):
    text = obj if isinstance(obj, str) else json.dumps(obj)
    return completion(SimpleNamespace(content=text, tool_calls=None), finish, rid)


def tool_response(calls, rid="req_tools"):
    return completion(SimpleNamespace(content="", tool_calls=[
        SimpleNamespace(id=f"call_{i}", type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args)))
        for i, (name, args) in enumerate(calls)]), "tool_calls", rid)


class FakeGroq:
    """Same surface the agent uses: client.chat.completions.create(...). `brain(kwargs, n)` decides each
    request; every request is recorded."""

    def __init__(self, brain):
        self.brain, self.calls = brain, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append({**{k: copy.deepcopy(v) for k, v in kw.items() if k != "messages"}, "messages": list(kw["messages"])})
        out = self.brain(kw, len(self.calls))
        if isinstance(out, Exception):
            raise out
        return out


def affected_from(kw):
    """The affected tickets the model was given in the first user message."""
    first = next(m["content"] for m in kw["messages"] if m["role"] == "user")
    return json.JSONDecoder().raw_decode(first[first.index("{"):])[0]["affected_tickets"]


def decide(kw, choose):
    """Final answer: choose(ticket) -> analyst id or None for every affected ticket."""
    return text_response({"decisions": [{
        "affected_ticket_id": t["ticket_id"], "deadline": t["deadline"],
        "short_impact_explanation": f"Due {t['deadline']}, during the leave.",
        "recommended_analyst_id": choose(t), "short_recommendation_reason": "Has closed similar tickets and free hours.",
        "handover_feasible": "yes"} for t in affected_from(kw)]})


def answers(choose):
    """A model that skips the tools and answers straight away."""
    return lambda kw, n: decide(kw, choose) if "response_format" in kw else text_response("", rid=f"req_{n}")


def first_eligible(kw, n):
    """Round 1: look up the first eligible colleague's records. Round 2: done. Final: pick them for every ticket."""
    if "response_format" in kw:
        return decide(kw, lambda t: t["eligible_analyst_ids"][0] if t["eligible_analyst_ids"] else None)
    if n == 1:
        calls = []
        for t in affected_from(kw):
            if t["eligible_analyst_ids"]:
                aid = t["eligible_analyst_ids"][0]
                calls += [("get_analyst_skills_and_experience", {"analyst_id": aid, "ticket_id": t["ticket_id"]}),
                          ("get_analyst_capacity", {"analyst_id": aid, "ticket_id": t["ticket_id"], "also_taking": []})]
        return tool_response(calls or [("get_affected_tickets", {})])
    return text_response("", rid="req_done")


def tool_messages(call):
    return [m for m in call["messages"] if m["role"] == "tool"]


# ── Fixtures ───────────────────────────────────────────────────────────────────

@contextmanager
def fresh_db():
    tmp = Path(tempfile.mkdtemp())
    old = repo.DB_PATH
    repo.DB_PATH = str(tmp / "test.db")
    saved = copy.deepcopy(impact.CONFIG)
    plan._cache.clear(); plan._picks.clear()
    try:
        seed(repo.DB_PATH)
        yield
    finally:
        repo.DB_PATH = old
        impact.CONFIG.clear(); impact.CONFIG.update(saved)
        plan._cache.clear(); plan._picks.clear()


def aid(name):
    return repo.get_analyst_by_name(name)["id"]


def clear_queue(analyst_id):
    for t in repo.get_tickets(assignee_id=analyst_id):
        if t["status"] in schedule.OPEN_ASSIGNED:
            repo.close_ticket(t["id"], None)


def ticket(analyst_id, deadline, likely, status="Assigned", priority="Medium", category="Reporting", title=None):
    tid = repo.create_ticket("Nurul Huda", "Finance", title or f"Test {category} ticket", None, category, priority,
                             deadline.isoformat(), {"low": likely * 0.7, "likely": likely, "high": likely * 1.5,
                                                    "method": "model"}, "High")
    repo.set_assignee(tid, analyst_id)
    if status != "Assigned":
        repo.set_status(tid, status)
    return tid


def busy_until_leave(analyst_id):
    """An earlier-due ticket that fills all working time before the leave, so later tickets need a handover."""
    return ticket(analyst_id, START - timedelta(days=3), 100, priority="Low", title="Filler due before leave")


def away(analyst_id, start, end, status="Approved", reason="Family matters"):
    lid = repo.create_leave(analyst_id, start.isoformat(), end.isoformat(), reason)
    if status != "Requested":
        repo.update_leave_status(lid, status)


def build(a, fake=None, **kw):
    return plan.build(a, str(kw.pop("start", START)), str(kw.pop("end", END)), kw.pop("hours_left", {}), client=fake, **kw)


def row(p, tid):
    return next(t for t in p["tickets"] if t["ticket_id"] == tid)


def snapshot():
    return [(t["id"], t["assignee_id"], t["status"]) for t in repo.get_tickets()], len(repo.assignment_log())


def sarah_needs_handover(*tickets_spec):
    a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
    return a, [ticket(a, START + timedelta(days=d), h, priority=p) for d, h, p in tickets_spec]


# ── Dates and affected-ticket detection (deterministic) ────────────────────────

def test_leave_date_validation():
    with fresh_db():
        a = aid("Sarah")
        assert any("ends before" in e for e in build(a, start=END, end=START)["errors"])
        assert not build(a, start=TODAY - timedelta(days=3), end=TODAY + timedelta(days=1))["valid"]
        assert not plan.build(a, "next monday", "2026-13-40", {})["valid"]
        away(a, START + timedelta(days=1), START + timedelta(days=2), status="Requested")
        assert any("overlaps" in e for e in build(a)["errors"])
        sat = START + timedelta(days=5)
        assert build(aid("Ravi"), start=sat, end=sat + timedelta(days=1))["warnings"] == ["These dates don't include any working days."]
        r = client.post("/leave-advisor/preview", json={"analyst_id": a, "start_date": str(START), "end_date": str(END),
                                                        "hours_left": {"999999": 2}})
        assert r.status_code == 400


def test_affected_tickets_during_and_after_leave_but_not_later_or_finishable():
    with fresh_db():
        a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
        during = ticket(a, START + timedelta(days=2), 6, priority="High")
        after = ticket(a, END + timedelta(days=3), 4)
        later = ticket(a, END + timedelta(days=40), 2, priority="Low")
        ids = [t["ticket_id"] for t in build(a)["tickets"]]
        assert during in ids and after in ids and later not in ids
    with fresh_db():
        a = aid("Sarah"); clear_queue(a)
        small = ticket(a, START + timedelta(days=1), 3)        # due during leave but fits in the week before it
        p = build(a)
        assert small not in [t["ticket_id"] for t in p["tickets"]] and p["source"] == "none_needed"
        assert p["ai"]["status"] == "not_needed"


def test_no_tickets_affected_makes_no_ai_call():
    with fresh_db():
        a = aid("Sarah"); clear_queue(a)
        fake = FakeGroq(first_eligible)
        p = build(a, fake)
        assert p["tickets"] == [] and fake.calls == []


def test_weekends_and_verified_holidays():
    with fresh_db():
        assert impact.working_days(START, START + timedelta(days=6), set()) == 5
        holiday = START + timedelta(days=2)
        impact.CONFIG["calendar"].update(verified=False, holidays=[{"date": holiday.isoformat(), "name": "T", "locations": ["all"]}])
        assert impact.holidays()[0] == set()
        assert build(aid("Aiman"))["calendar"]["label"] == "Public holidays not configured"
        impact.CONFIG["calendar"]["verified"] = True
        assert impact.holidays()[0] == {holiday}
        impact.CONFIG["calendar"]["holidays"][0]["locations"] = ["Penang"]
        assert impact.holidays()[0] == set()


# ── The AI agent (mocked Groq) ─────────────────────────────────────────────────

def test_ai_picks_through_read_only_tools_and_the_backend_accepts():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        impact.CONFIG["ai"]["max_tool_rounds"] = 3          # room for a look-up round and a "done" round
        fake = FakeGroq(first_eligible)
        p = build(a, fake)
        s = row(p, t1)
        assert p["source"] == "ai" and p["ai"]["status"] == "ok" and p["ai"]["provider"] == "groq"
        assert s["decided_by"] == "ai" and s["recommended"] and s["recommended"]["id"] != a and s["handover_feasible"] == "yes"
        assert p["ai"]["request_ids"] == ["req_tools", "req_done", "req_final"] and p["ai"]["turns"] == 3
        first, final = fake.calls[0], fake.calls[-1]
        assert first["model"] == MODEL and first["tool_choice"] == "auto" and first["temperature"] == 0
        assert {t["function"]["name"] for t in first["tools"]} == {
            "get_affected_tickets", "get_eligible_analysts", "get_analyst_skills_and_experience", "get_analyst_capacity"}
        # Groq can't combine tools and structured outputs: the final request has the schema and no tools
        assert "tools" not in final and final["response_format"]["json_schema"]["strict"] is True
        assert "Records you looked up" in final["messages"][1]["content"]
        # Tool results went back with matching call IDs
        results = tool_messages(fake.calls[1])
        assert {m["tool_call_id"] for m in results} == {"call_0", "call_1"}
        assert {"declared_skills", "closed_tickets_of_this_type"} <= set(json.loads(results[0]["content"]))


def test_client_has_no_retries_and_a_timeout():
    os.environ["GROQ_API_KEY"] = "gsk_test_not_real"
    try:
        c, why = agent.make_client()
        assert why is None and c.max_retries == 0 and c.timeout == float(impact.CONFIG["ai"]["timeout_seconds"])
    finally:
        os.environ.pop("GROQ_API_KEY", None)
    assert agent.make_client()[0] is None and "GROQ_API_KEY" in agent.make_client()[1]


def test_tool_errors_go_back_to_the_model_instead_of_crashing():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        def brain(kw, n):
            if "response_format" in kw:
                return decide(kw, lambda t: None)
            if n == 1:
                return tool_response([("get_analyst_capacity", {"analyst_id": a, "ticket_id": t1, "also_taking": []}),
                                      ("get_analyst_skills_and_experience", {"analyst_id": 1, "ticket_id": 999999})])
            return text_response("", rid="req_done")
        fake = FakeGroq(brain)
        build(a, fake)
        assert all("error" in json.loads(m["content"]) for m in tool_messages(fake.calls[1]))   # requester; unknown ticket


def test_ai_picking_an_ineligible_analyst_is_rejected():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        for bad in (a, 999999):
            plan._cache.clear(); plan._picks.clear()
            s = row(build(a, FakeGroq(answers(lambda t, bad=bad: bad))), t1)
            assert s["recommended"] is None and s["decided_by"] == "rejected" and s["handover_feasible"] == "no"


def test_combined_workload_prevents_double_booking():
    with fresh_db():
        a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
        helper = aid("Jun Wei"); clear_queue(helper)
        for name in ("Aiman", "Mei Ling", "Ravi"):
            away(aid(name), TODAY, END + timedelta(days=30))
        deadline = START + timedelta(days=1)
        size = round(schedule.working_hours(TODAY, deadline, schedule.leave_days(helper), 8) * 0.6, 1)
        big1 = ticket(a, deadline, size, priority="Critical")
        big2 = ticket(a, deadline, size, priority="High")
        # The AI gives both to the same colleague; only the more urgent one fits
        p = build(a, FakeGroq(answers(lambda t: helper)))
        assert row(p, big1)["recommended"]["id"] == helper
        assert row(p, big2)["recommended"] is None and row(p, big2)["decided_by"] == "rejected"
        # The capacity tool counts also_taking, so the AI can see the conflict before answering
        rows = {r["ticket_id"]: r for r in plan._affected(impact.analyse(a, START, END, {}))}
        tool = plan.dispatcher(rows, Context(a, TODAY, set(), repo.handover_counts()))
        alone = tool("get_analyst_capacity", {"analyst_id": helper, "ticket_id": big2, "also_taking": []})
        both = tool("get_analyst_capacity", {"analyst_id": helper, "ticket_id": big2, "also_taking": [big1]})
        assert alone["fits"] and not both["fits"] and both["booked_hours_now"] > alone["booked_hours_now"]


def test_no_eligible_replacement_shows_team_lead_review():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 10, "High"))
        for name in ("Aiman", "Mei Ling", "Ravi", "Jun Wei"):
            away(aid(name), TODAY, END + timedelta(days=30))
        fake = FakeGroq(first_eligible)
        s = row(build(a, fake), t1)
        assert s["recommended"] is None and "Team Lead review required" in s["reason"]
        assert fake.calls == []                 # nobody eligible: nothing for the AI to choose, so it isn't asked


def test_waiting_tickets_can_be_handed_over():
    with fresh_db():
        a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
        tid = ticket(a, START + timedelta(days=2), 8, status="Waiting", priority="High")
        fake = FakeGroq(first_eligible)
        s = row(build(a, fake), tid)
        assert fake.calls and affected_from(fake.calls[0])[0]["eligible_analyst_ids"]     # offered to the AI
        assert s["decided_by"] == "ai" and s["recommended"] is not None
        assert s["handover_feasible"] == "unknown"                       # remaining effort of a Waiting ticket is uncertain


def test_unknown_remaining_effort_makes_feasibility_unknown():
    with fresh_db():
        a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
        tid = ticket(a, START + timedelta(days=2), 6, status="In progress", priority="High")
        s = row(build(a, FakeGroq(first_eligible)), tid)
        assert s["recommended"] and s["handover_feasible"] == "unknown"
        plan._cache.clear(); plan._picks.clear()
        s = row(build(a, FakeGroq(first_eligible), hours_left={tid: 3}), tid)
        assert s["handover_feasible"] == "yes"


# ── Failures and fallbacks ─────────────────────────────────────────────────────

def test_api_failures_fall_back_to_a_labelled_rule_based_pick():
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    failures = [groq.APITimeoutError(request=req), groq.APIConnectionError(request=req),
                text_response({"decisions": [{"affected_ticket_id": "not a number"}]}),
                text_response("{not json"), text_response({"decisions": []}, finish="length")]
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        for f in failures:
            plan._cache.clear(); plan._picks.clear()
            p = build(a, FakeGroq(lambda kw, n, f=f: f if (isinstance(f, Exception) or "response_format" in kw)
                                  else text_response("", rid="req_done")))
            assert p["source"] == "rule_based" and p["ai"]["status"] == "unavailable" and p["ai"]["reason"], f
            assert row(p, t1)["decided_by"] == "rule_based"


def test_a_short_rate_limit_is_retried_once_and_a_long_one_falls_back():
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    limited = lambda wait: groq.RateLimitError("rate limited", body=None,
                                               response=httpx.Response(429, headers={"retry-after": str(wait)}, request=req))
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        seen = []
        def brain(kw, n):                       # the very first request is rate limited, with a 0s retry-after
            seen.append(n)
            return limited(0) if n == 1 else answers(lambda t: t["eligible_analyst_ids"][0])(kw, n)
        p = build(a, FakeGroq(brain))
        assert p["source"] == "ai" and seen[:2] == [1, 2]
        plan._cache.clear(); plan._picks.clear()
        p = build(a, FakeGroq(lambda kw, n: limited(60)))          # longer than the wait cap: no sleeping, fall back
        assert p["source"] == "rule_based" and "rate limited" in p["ai"]["reason"]


def test_a_failed_json_validation_is_retried_once():
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    body = {"error": {"message": "Failed to validate JSON.", "code": "json_validate_failed", "failed_generation": ""}}
    invalid = groq.BadRequestError("Failed to validate JSON.", body=body,
                                   response=httpx.Response(400, json=body, request=req))
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        finals = []
        def brain(kw, n):
            if "response_format" not in kw:
                return text_response("", rid="req_done")
            finals.append(n)
            return invalid if len(finals) == 1 else decide(kw, lambda t: t["eligible_analyst_ids"][0])
        p = build(a, FakeGroq(brain))
        assert p["source"] == "ai" and len(finals) == 2
        plan._cache.clear(); plan._picks.clear()
        p = build(a, FakeGroq(lambda kw, n: invalid if "response_format" in kw else text_response("")))
        assert p["source"] == "rule_based" and "(400)" in p["ai"]["reason"]      # fails twice: labelled fallback


def test_no_ai_call_when_nobody_is_eligible():
    with fresh_db():
        a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
        tid = ticket(a, START + timedelta(days=2), 8, status="Waiting", priority="High")
        for name in ("Aiman", "Mei Ling", "Ravi", "Jun Wei"):
            away(aid(name), TODAY, END + timedelta(days=30))
        fake = FakeGroq(first_eligible)
        p = build(a, fake)
        assert fake.calls == [] and p["source"] == "none_needed" and p["ai"]["status"] == "not_needed"
        assert row(p, tid)["recommended"] is None


def test_suggested_deadline_comes_from_the_forecast_and_never_moves_the_official_one():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        p = build(a, FakeGroq(first_eligible))
        s = row(p, t1)
        projected = s["projected_completion"]
        assert projected and s["suggested_deadline"] == max(projected, s["deadline"])
        assert repo.get_ticket(t1)["deadline"] == s["deadline"]            # official deadline unchanged
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 10, "High"))
        for name in ("Aiman", "Mei Ling", "Ravi", "Jun Wei"):
            away(aid(name), TODAY, END + timedelta(days=30))
        s = row(build(a, FakeGroq(first_eligible)), t1)
        # No replacement: the suggestion is the analyst's own forecast if there is one, never a made-up date
        assert s["suggested_deadline"] in (None, max(s["projected_if_kept"], s["deadline"]) if s["projected_if_kept"] else None)


def test_tool_rounds_are_bounded_then_one_final_answer():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        fake = FakeGroq(lambda kw, n: decide(kw, lambda t: None) if "response_format" in kw
                        else tool_response([("get_affected_tickets", {})]))
        p = build(a, fake)
        rounds = int(impact.CONFIG["ai"]["max_tool_rounds"])
        assert len(fake.calls) == rounds + 1 and "response_format" in fake.calls[-1]
        assert p["ai"]["status"] == "ok" and p["ai"]["turns"] == rounds + 1


def test_without_a_key_the_ai_is_unavailable_not_invented():
    with fresh_db():
        a, _ = sarah_needs_handover((2, 6, "High"))
        p = build(a)
        assert p["ai"]["status"] == "unavailable" and "GROQ_API_KEY" in p["ai"]["reason"]
        assert p["source"] == "rule_based" and p["ai"]["request_ids"] == []


def test_results_are_cached_until_the_data_changes():
    with fresh_db():
        a, _ = sarah_needs_handover((2, 6, "High"))
        fake = FakeGroq(first_eligible)
        build(a, fake)
        n = len(fake.calls)
        assert build(a, fake)["cached"] and len(fake.calls) == n            # same dates, same data
        ticket(a, START + timedelta(days=3), 5, priority="High")           # the data changed
        assert not build(a, fake)["cached"] and len(fake.calls) > n


# ── Privacy ────────────────────────────────────────────────────────────────────

def test_the_ai_and_the_ui_never_see_leave_reasons_or_performance_metrics():
    with fresh_db():
        a, _ = sarah_needs_handover((2, 6, "High"))
        away(aid("Aiman"), START, START, status="Requested", reason="Hospital appointment")
        fake = FakeGroq(first_eligible)
        p = build(a, fake)
        sent = json.dumps([c["messages"] for c in fake.calls], default=str)
        shown = json.dumps(p)
        for text in (sent, shown):
            assert "Hospital appointment" not in text and "Family matters" not in text
            for banned in ("track_record", "revision_rate", "accuracy", "partnership", "pairing", "leave_reason",
                           "start_date\": \"" + START.isoformat() + "\", \"end_date\": \"" + START.isoformat()):
                assert banned not in text, banned


# ── Submitting ─────────────────────────────────────────────────────────────────

def test_submit_stores_the_proposal_and_never_reassigns():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 8, "High"))
        real = agent.make_client
        fake = FakeGroq(first_eligible)
        agent.make_client = lambda: (fake, None)        # what the endpoints use
        try:
            before = snapshot()
            r = client.post("/leave-advisor/preview", json={"analyst_id": a, "start_date": str(START), "end_date": str(END)})
            assert r.status_code == 200 and r.json()["source"] == "ai"
            n = len(fake.calls)
            sub = client.post("/leave-advisor/requests", json={"analyst_id": a, "start_date": str(START),
                                                               "end_date": str(END), "reason": "Annual leave"})
            assert sub.status_code == 201, sub.text
            assert len(fake.calls) == n                 # submit reused the cached suggestions
        finally:
            agent.make_client = real
        body = sub.json()
        assert body["reassigned"] is False and body["leave"]["status"] == "Requested"
        assert snapshot() == before
        stored = client.get(f"/leave-advisor/leave/{body['leave']['id']}/plan", params={"user": "Sarah"}).json()
        assert stored["status"] == "Proposed" and stored["plan"]["source"] == "ai"
        assert row(stored["plan"], t1)["recommended"]


def test_leave_can_be_sent_when_the_ai_is_unavailable():
    with fresh_db():
        a, _ = sarah_needs_handover((2, 8, "High"))
        sub = client.post("/leave-advisor/requests", json={"analyst_id": a, "start_date": str(START), "end_date": str(END)})
        assert sub.status_code == 201
        stored = client.get(f"/leave-advisor/leave/{sub.json()['leave']['id']}/plan", params={"user": "Sarah"}).json()
        assert stored["plan"]["source"] == "rule_based" and stored["plan"]["ai"]["status"] == "unavailable"


def test_plan_access_and_team_lead_authority():
    with fresh_db():
        a = aid("Ravi")
        s, e = str(START + timedelta(days=14)), str(END + timedelta(days=14))
        lid = client.post("/leave-advisor/requests", json={"analyst_id": a, "start_date": s, "end_date": e}).json()["leave"]["id"]
        url = f"/leave-advisor/leave/{lid}/plan"
        assert client.get(url, params={"user": "Ravi"}).status_code == 200
        assert client.get(url, params={"user": "Team lead", "role": "lead"}).status_code == 200
        assert client.get(url, params={"user": "Sarah"}).status_code == 403
        paths = [p for p in client.get("/openapi.json").json()["paths"] if p.startswith("/leave-advisor")]
        assert sorted(paths) == ["/leave-advisor/leave/{leave_id}/plan", "/leave-advisor/preview",
                                 "/leave-advisor/reassign", "/leave-advisor/requests"]
        # The AI only ever reads: reassigning is an action the analyst takes, never a tool the model can call
        names = {t["function"]["name"] for t in agent.TOOLS}
        assert not [n for n in names if any(w in n for w in ("approve", "assign", "update", "edit", "set_", "create"))]
        assert client.patch(f"/planning/leave/{lid}", json={"status": "Approved"}).status_code == 200    # still the lead's
        again = client.post("/leave-advisor/requests", json={"analyst_id": a, "start_date": s, "end_date": e})
        assert again.status_code == 400


def test_existing_leave_endpoint_is_unchanged():
    with fresh_db():
        r = client.post("/planning/leave", json={"analyst_id": aid("Aiman"), "start_date": str(START), "end_date": str(END)})
        assert r.status_code == 201 and "whatif" in r.json() and r.json()["status"] == "Requested"


def test_suitability_is_a_rule_based_score_from_real_parts():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        s = row(build(a, FakeGroq(first_eligible)), t1)
        suit = s["suitability"]
        assert suit["method"] == "rule-based" and 0 <= suit["score"] <= 100
        parts = {p["key"]: p for p in suit["parts"]}
        assert set(parts) == {"skills", "experience", "domain", "capacity", "deadline"}
        used = [p for p in parts.values() if p["value"] is not None]
        expected = round(100 * sum(p["weight"] * p["value"] for p in used) / sum(p["weight"] for p in used))
        assert abs(suit["score"] - expected) <= 1                         # parts are rounded to 2 decimals for display
        assert suit["experience"]["closed_this_type"] >= 0 and "fits" in suit["capacity"]
        # A type nobody has closed before: experience is insufficient data, not a made-up number
    with fresh_db():
        a = aid("Sarah"); clear_queue(a); busy_until_leave(a)
        tid = ticket(a, START + timedelta(days=2), 6, priority="High", category="Quantum forecasting")
        s = row(build(a, FakeGroq(first_eligible)), tid)
        if s["suitability"]:
            assert next(p for p in s["suitability"]["parts"] if p["key"] == "experience")["value"] is None


def test_keep_is_the_default_and_reassign_only_proposes():
    with fresh_db():
        a, (t1, t2) = sarah_needs_handover((2, 6, "High"), (3, 5, "Medium"))
        real = agent.make_client
        agent.make_client = lambda: (FakeGroq(first_eligible), None)
        try:
            before = snapshot()
            body = {"analyst_id": a, "start_date": str(START), "end_date": str(END)}
            sub = client.post("/leave-advisor/requests", json={**body, "choices": {str(t1): "reassign"}})
            assert sub.status_code == 201, sub.text
        finally:
            agent.make_client = real
        out = sub.json()
        assert [h["ticket_id"] for h in out["proposed_handovers"]] == [t1] and out["reassigned"] is False
        assert "Team Lead approval" in out["proposed_handovers"][0]["status"]
        assert snapshot() == before                                         # nothing was reassigned
        stored = client.get(f"/leave-advisor/leave/{out['leave']['id']}/plan", params={"user": "Sarah"}).json()["plan"]
        assert stored["choices"] == {str(t1): "reassign", str(t2): "keep"}  # t2 defaulted to keep
        assert row(stored, t2)["recommended"] is not None                   # the recommendation stays visible


def test_reassign_is_refused_without_a_replacement():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 10, "High"))
        for name in ("Aiman", "Mei Ling", "Ravi", "Jun Wei"):
            away(aid(name), TODAY, END + timedelta(days=30))
        body = {"analyst_id": a, "start_date": str(START), "end_date": str(END)}
        assert client.post("/leave-advisor/requests", json={**body, "choices": {str(t1): "reassign"}}).status_code == 400
        assert client.post("/leave-advisor/requests", json={**body, "choices": {"999999": "keep"}}).status_code == 400
        ok = client.post("/leave-advisor/requests", json={**body, "choices": {str(t1): "keep"}})
        assert ok.status_code == 201 and ok.json()["proposed_handovers"] == []


# ── Immediate reassignment ─────────────────────────────────────────────────────

def reassign(a, tid, to, user="Sarah"):
    return client.post("/leave-advisor/reassign", json={"analyst_id": a, "start_date": str(START), "end_date": str(END),
                                                        "ticket_id": tid, "to_analyst_id": to, "user": user})


def with_fake(brain):
    """Route the endpoints' AI calls to a fake Groq; returns (fake, restore)."""
    real, fake = agent.make_client, FakeGroq(brain)
    agent.make_client = lambda: (fake, None)
    return fake, lambda: setattr(agent, "make_client", real)


def test_reassign_changes_the_real_assignee_once_and_keeps_the_deadline():
    with fresh_db():
        a, (t1, t2) = sarah_needs_handover((2, 6, "Critical"), (3, 5, "High"))
        fake, restore = with_fake(first_eligible)
        try:
            p = client.post("/leave-advisor/preview", json={"analyst_id": a, "start_date": str(START), "end_date": str(END)}).json()
            target = row(p, t1)["recommended"]["id"]
            deadline_before = repo.get_ticket(t1)["deadline"]
            calls = len(fake.calls)
            r = reassign(a, t1, target)
            assert r.status_code == 200, r.text
            body = r.json()
            t = repo.get_ticket(t1)
            assert t["assignee_id"] == target and body["ticket"]["assignee_id"] == target
            assert t["deadline"] == deadline_before                               # never extended automatically
            log = [x for x in repo.assignment_log() if x["ticket_id"] == t1]
            assert log and log[0]["chosen_id"] == target and log[0]["decided_by"] == "Sarah"
            # Refreshed suggestions: t1 is gone from the affected list and shows as handed over; t2 re-checked,
            # reusing the earlier AI picks (no new AI call)
            s = body["suggestions"]
            assert t1 not in [x["ticket_id"] for x in s["tickets"]] and t2 in [x["ticket_id"] for x in s["tickets"]]
            assert [h["ticket_id"] for h in s["reassigned"]] == [t1] and s["reassigned"][0]["still_with_them"]
            assert s["stats"]["reassigned"] == 1 and s["ai"]["reused"] and len(fake.calls) == calls
            # A second click can't transfer it again
            again = reassign(a, t1, target)
            assert again.status_code == 409 and repo.get_ticket(t1)["assignee_id"] == target
        finally:
            restore()


def test_reassign_is_only_to_the_current_recommendation_and_only_by_the_analyst():
    with fresh_db():
        a, (t1,) = sarah_needs_handover((2, 6, "High"))
        fake, restore = with_fake(first_eligible)
        try:
            p = client.post("/leave-advisor/preview", json={"analyst_id": a, "start_date": str(START), "end_date": str(END)}).json()
            target = row(p, t1)["recommended"]["id"]
            other = next(x["id"] for x in repo.get_analysts() if x["id"] not in (a, target))
            before = snapshot()
            assert reassign(a, t1, other).status_code == 409                # not the recommended colleague
            assert reassign(a, t1, target, user="Aiman").status_code == 403  # someone else can't hand it over
            assert reassign(a, 999999, target).status_code == 404
            assert snapshot() == before                                       # nothing changed
        finally:
            restore()


def test_keep_changes_nothing_and_statistics_reflect_real_figures():
    with fresh_db():
        a, (t1, t2) = sarah_needs_handover((2, 6, "High"), (3, 5, "Low"))
        before = snapshot()
        p = build(a, FakeGroq(first_eligible))
        assert snapshot() == before                                           # previewing (= keeping) changes nothing
        st = p["stats"]
        assert st["affected"] == 2 and st["by_urgency"]["High"] == 1 and st["by_urgency"]["Low"] == 1
        assert [x["ticket_id"] for x in p["tickets"]] == [t1, t2]              # most urgent first
        recs = [x for x in p["tickets"] if x["recommended"]]
        assert st["extra_team_hours"] == round(sum(x["team_effect"]["extra_hours"] for x in recs), 1)
        for x in recs:
            assert x["projected_completion"] == x["suitability"]["capacity"]["finish_if_taken"]
            assert x["proposed_revised_deadline"] in (None, x["projected_completion"])
            if x["proposed_revised_deadline"]:
                assert x["proposed_revised_deadline"] > x["deadline"]
            assert x["urgency"]["why"].startswith(f"{x['priority']} priority")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
