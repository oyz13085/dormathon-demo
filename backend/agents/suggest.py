"""
Agentic ticket suggestion: classify → priority (KPI RAG) → estimate hours →
recommend assignee → similar past work.

With an API key this is a real tool-calling loop: the model decides which
tools to call and in what order (estimate needs the category and priority
first), then composes the suggestion from tool outputs. Every number still
comes from a FairQueue tool, never from the model.

Without a key (or on any failure) the same tools run in fixed order and each
step keeps its own method label ("rule-based" / "model"), exactly as before.
"""
from __future__ import annotations
from datetime import date
from fairqueue.config import LLM
from fairqueue.llm import tool_loop

TOOLS = [
    {"name": "predict_department", "description": "Which department's work is this request (HR, IT, Finance, Marketing).",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "description": {"type": ["string", "null"]},
         "requester": {"type": "string"}},
         "required": ["title", "requester"], "additionalProperties": False}},
    {"name": "classify_ticket", "description": "Map free text to a known ticket category.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "description": {"type": ["string", "null"]}},
         "required": ["title"], "additionalProperties": False}},
    {"name": "suggest_priority", "description": "Suggest a priority using the department KPI document and deadline.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "description": {"type": ["string", "null"]},
         "division": {"type": "string"}, "deadline": {"type": "string"}},
         "required": ["title", "division", "deadline"], "additionalProperties": False}},
    {"name": "estimate_hours", "description": "Predict low/likely/high hours for a category, priority and division.",
     "input_schema": {"type": "object", "properties": {
         "category": {"type": "string"}, "priority": {"type": "string"}, "division": {"type": "string"}},
         "required": ["category", "priority", "division"], "additionalProperties": False}},
    {"name": "recommend_assignee", "description": "Score analysts for a ticket draft and recommend one.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "division": {"type": "string"}, "category": {"type": "string"},
         "priority": {"type": "string"}, "deadline": {"type": "string"},
         "pred_low": {"type": ["number", "null"]}, "pred_likely": {"type": ["number", "null"]},
         "pred_high": {"type": ["number", "null"]}, "confidence": {"type": ["string", "null"]}},
         "required": ["title", "division", "category", "priority", "deadline"],
         "additionalProperties": False}},
    {"name": "similar_work", "description": "Past deliverables similar to this request.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "description": {"type": ["string", "null"]},
         "category": {"type": ["string", "null"]}},
         "required": ["title"], "additionalProperties": False}},
]

_SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string"},
        "priority": {"type": "string", "enum": ["Low", "Medium", "High", "Critical"]},
        "priority_reason": {"type": "string"},
        "hours_low": {"type": "number"},
        "hours_likely": {"type": "number"},
        "hours_high": {"type": "number"},
    },
    "required": ["category", "priority", "priority_reason", "hours_low", "hours_likely", "hours_high"],
    "additionalProperties": False,
}


def _dispatch(name: str, args: dict, known: list[str]) -> dict:
    from fairqueue.llm import extract_category, predict_department, suggest_priority
    from fairqueue.models.hours import predict_hours
    from fairqueue.engine.fit import recommend
    from fairqueue import views
    if name == "predict_department":
        return predict_department(args.get("title", ""), args.get("description") or "",
                                  args.get("requester", ""))
    if name == "classify_ticket":
        return extract_category(args.get("title", ""), args.get("description") or "", known)
    if name == "suggest_priority":
        return suggest_priority(args.get("title", ""), args.get("description") or "",
                                args["division"], args["deadline"])
    if name == "estimate_hours":
        return predict_hours(args["category"], args["priority"], args["division"])
    if name == "recommend_assignee":
        draft = {"id": None, "title": args["title"], "division": args["division"],
                 "requester": "", "category": args["category"], "priority": args["priority"],
                 "deadline": args["deadline"], "pred_low": args.get("pred_low"),
                 "pred_likely": args.get("pred_likely"), "pred_high": args.get("pred_high"),
                 "confidence": args.get("confidence", "High"), "status": "Unassigned"}
        return recommend(draft)
    if name == "similar_work":
        return {"results": views.similar_work(args.get("title", ""), args.get("description"),
                                              args.get("category"))}
    return {"error": f"Unknown tool {name}"}


def _fixed_pipeline(title: str, deadline: str, description: str | None,
                    requester: str, known: list[str]) -> dict:
    """The same tools, fixed order. Used with no API key; step methods stay labelled."""
    description = description or ""
    dep = _dispatch("predict_department", {"title": title, "description": description,
                                           "requester": requester}, known)
    division = dep["division"]
    cat = _dispatch("classify_ticket", {"title": title, "description": description}, known)
    pri = _dispatch("suggest_priority", {"title": title, "description": description,
                                        "division": division, "deadline": deadline}, known)
    hours = _dispatch("estimate_hours", {"category": cat["category"], "priority": pri["priority"],
                                         "division": division}, known)
    return {"dep": dep, "cat": cat, "pri": pri, "hours": hours, "tool_calls": [],
            "confidence": "Low" if "Low" in (cat["confidence"], hours["confidence"]) else "High"}


def run(title: str, deadline: str, description: str, requester: str) -> dict:
    """Full suggestion. Returns everything GET callers need except the trimmed
    requester card (the endpoint still applies _requester_card)."""
    from fairqueue.models.hours import known_categories
    known = known_categories()
    system = (
        "You triage a ticket for a data analytics team. First call predict_department, "
        "then classify_ticket, suggest_priority and estimate_hours using that department; "
        "estimation needs the category and priority first. Then call recommend_assignee "
        "and similar_work. Never invent hours, names or departments yourself; use tool "
        "outputs. A person confirms everything."
    )
    user = (f"Title: {title}\nDescription: {description or '(none)'}\n"
            f"Requester: {requester}\nDeadline: {deadline}\nToday: {date.today().isoformat()}")
    gathered, calls, _ = tool_loop(system, user, TOOLS, lambda n, a: _dispatch(n, a, known),
                                   required=("predict_department", "classify_ticket",
                                             "suggest_priority", "estimate_hours"))
    if not {"predict_department", "classify_ticket", "suggest_priority", "estimate_hours"} <= set(gathered):
        out = _fixed_pipeline(title, deadline, description or "", requester, known)
        return _assemble(out, title, deadline, description or "", known)
    return _assemble({"dep": gathered["predict_department"], "cat": gathered["classify_ticket"],
                      "pri": gathered["suggest_priority"], "hours": gathered["estimate_hours"],
                      "tool_calls": calls,
                      "recommend": gathered.get("recommend_assignee"),
                      "similar": (gathered.get("similar_work") or {}).get("results"),
                      "confidence": None}, title, deadline, description or "", known)


def _assemble(out: dict, title: str, deadline: str, description: str, known: list[str]) -> dict:
    """One Suggestion-shaped dict from tool outputs, however they were gathered."""
    from fairqueue.engine.fit import recommend
    from fairqueue import views
    dep, cat, pri, hours = out["dep"], out["cat"], out["pri"], out["hours"]
    division = dep["division"]
    confidence = out.get("confidence")
    if confidence is None:
        confidence = "Low" if "Low" in (cat["confidence"], hours["confidence"]) else "High"
    draft = {"id": None, "title": title, "division": division, "requester": "",
             "category": cat["category"], "priority": pri["priority"], "deadline": deadline,
             "pred_low": hours["low"], "pred_likely": hours["likely"], "pred_high": hours["high"],
             "confidence": confidence, "status": "Unassigned"}
    card = out.get("recommend") or recommend(draft)
    similar = out.get("similar")
    if similar is None:
        similar = views.similar_work(title, description, cat["category"])
    return {"division": division, "division_method": dep.get("method"),
            "category": cat["category"], "category_method": cat.get("method"), "confidence": confidence,
            "priority": pri["priority"], "priority_reason": pri["reason"], "priority_method": pri.get("method"),
            "hours": {k: hours[k] for k in ("low", "likely", "high", "method")},
            "card": card, "similar_work": similar, "tool_calls": out.get("tool_calls", [])}
