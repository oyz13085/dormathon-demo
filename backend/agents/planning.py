"""
Planning assistant for the team lead: answers questions such as
"If Ravi takes leave next week, which deadlines break?" in 2-4 sentences.

Every number comes from a FairQueue tool (what-if, forecast, risk, workload), never
from the model. Without an API key, or if the call fails, a rule-based answer is used.
"""
from __future__ import annotations
from datetime import date, timedelta
from fairqueue.db import repo
from fairqueue.engine.forecast import forecast
from fairqueue.engine.risk import risk_list
from fairqueue.engine.whatif import whatif_leave
from fairqueue.llm import tool_loop

TOOLS = [
    {"name": "what_if_leave", "description": "Which deadlines break if an analyst is on leave for a date range.",
     "input_schema": {"type": "object", "properties": {
         "analyst_name": {"type": "string"}, "start_date": {"type": "string", "description": "YYYY-MM-DD"},
         "end_date": {"type": "string", "description": "YYYY-MM-DD"}},
         "required": ["analyst_name", "start_date", "end_date"], "additionalProperties": False}},
    {"name": "volume_forecast", "description": "Forecast ticket hours vs team capacity for the coming weeks.",
     "input_schema": {"type": "object", "properties": {"n_weeks": {"type": ["integer", "null"]},
                                                       "division": {"type": ["string", "null"]}},
                      "required": [], "additionalProperties": False}},
    {"name": "at_risk_tickets", "description": "Open tickets likely to miss their deadline, with causes.",
     "input_schema": {"type": "object", "properties": {"division": {"type": ["string", "null"]}},
                      "required": [], "additionalProperties": False}},
    {"name": "workload", "description": "Open predicted hours per analyst against weekly hours.",
     "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False}},
]


def _dispatch(name: str, args: dict) -> dict:
    if name == "what_if_leave":
        a = repo.get_analyst_by_name(args["analyst_name"])
        if not a:
            return {"error": f"No analyst called {args['analyst_name']}"}
        return whatif_leave(a["id"], args["start_date"], args["end_date"])
    if name == "volume_forecast":
        return forecast(int(args.get("n_weeks") or 2), args.get("division"))
    if name == "at_risk_tickets":
        r = risk_list(args.get("division"))
        return {"alerts": r["alerts"], "watch": r["watch"][:5]}
    if name == "workload":
        from fairqueue.engine.schedule import open_hours
        return {"analysts": [{"name": a["name"], "open_hours": open_hours(a["id"]),
                              "weekly_hours": a["weekly_hours"]} for a in repo.get_analysts()]}
    return {"error": f"Unknown tool {name}"}


def _next_week() -> tuple[str, str]:
    today = date.today()
    monday = today + timedelta(days=7 - today.weekday())
    return monday.isoformat(), (monday + timedelta(days=4)).isoformat()


def _fallback(question: str) -> dict:
    q = question.lower()
    for a in repo.get_analysts():
        if a["name"].lower() in q and "leave" in q:
            start, end = _next_week()
            w = whatif_leave(a["id"], start, end)
            moves = "; ".join(f"'{b['title']}' to {b['takeover']['name']}" for b in w["broken"] if b.get("takeover"))
            return {"answer": w["summary"] + (f" Suggested takeovers: {moves}." if moves else ""),
                    "data": w, "method": "rule-based"}
    if "risk" in q or "miss" in q:
        r = risk_list()
        top = "; ".join(f"'{x['ticket_title']}' ({round(x['p_miss'] * 100)}%, {x['cause']})" for x in r["alerts"])
        return {"answer": f"{len(r['alerts'])} ticket(s) are above the alert threshold" + (f": {top}." if top else "."),
                "data": r["alerts"], "method": "rule-based"}
    if any(w in q for w in ("spare", "free", "who has", "who can", "available", "busy", "workload", "overload")):
        from fairqueue.engine.schedule import open_hours
        rows = sorted(({"name": a["name"], "free": round(a["weekly_hours"] - open_hours(a["id"]), 1),
                        "weekly": a["weekly_hours"]} for a in repo.get_analysts()), key=lambda r: -r["free"])
        free = [r for r in rows if r["free"] > 0]
        full = [r["name"] for r in rows if r["free"] <= 0]
        answer = ("Most free this week: " + ", ".join(f"{r['name']} ({r['free']:g}h of {r['weekly']:g}h)" for r in free[:3]) + "."
                  if free else "Nobody has free hours this week.")
        if full:
            answer += f" Fully booked: {', '.join(full)}."
        return {"answer": answer, "data": rows, "method": "rule-based"}
    f = forecast(2)
    return {"answer": " ".join(w["message"] for w in f["weeks"]), "data": f, "method": "rule-based"}


def run(question: str) -> dict:
    system = (f"You help the lead of a data analytics team plan capacity. Today is {date.today().isoformat()} "
              f"({date.today().strftime('%A')}). Call tools to get every number; never estimate numbers yourself. "
              "Answer in 2-4 plain sentences. Never rank analysts by speed.")
    _, calls, text = tool_loop(system, question, TOOLS, _dispatch)
    if text:
        return {"answer": text, "tool_calls": calls, "method": "llm"}
    return _fallback(question)
