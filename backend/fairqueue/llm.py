"""
Language tasks: priority suggestion (RAG over KPI docs), ticket-text extraction,
and one-sentence explanations.

The LLM only ever suggests. Every call has a rule-based fallback, labelled
"rule-based", used when there is no API key, the call is slow, fails, or
returns invalid JSON. Outputs are cached in agent_cache by the caller.
"""
from __future__ import annotations
import json
import os
import re
from datetime import date, datetime
from fairqueue.config import LLM, DATA_DIR

KPI_DIR = DATA_DIR / "kpi_docs"
PRIORITIES = ("Low", "Medium", "High", "Critical")

_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    try:
        import anthropic
        client = anthropic.Anthropic()
        # Constructing succeeds without credentials; check something is configured
        if not (client.api_key or client.auth_token):
            return None
        _client = client
        return _client
    except Exception:
        return None


def get_provider() -> str | None:
    """Configured LLM provider with a key present, else None (rule fallbacks)."""
    want = str(LLM.get("provider") or "anthropic").lower()
    if want == "gemini":
        return "gemini" if os.getenv("GEMINI_API_KEY") else None
    if want == "groq":
        return "groq" if os.getenv("GROQ_API_KEY") else None
    return "anthropic" if _get_client() is not None else None


def llm_enabled() -> bool:
    return get_provider() is not None


def _ask_json_gemini(system: str, user: str, schema: dict) -> dict | None:
    try:
        from google import genai
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        resp = client.models.generate_content(
            model=LLM["model"], contents=user,
            config={"system_instruction": system, "temperature": 0,
                    "response_mime_type": "application/json",
                    "response_json_schema": schema})
        return json.loads(resp.text or "")
    except Exception:
        return None


def _groq_client():
    from openai import OpenAI
    return OpenAI(api_key=os.getenv("GROQ_API_KEY"), base_url="https://api.groq.com/openai/v1",
                  timeout=float(LLM["timeout_seconds"]), max_retries=0)


def _ask_json_groq(system: str, user: str, schema: dict) -> dict | None:
    try:
        client = _groq_client()
        messages = [{"role": "system", "content": system + " Reply with JSON only."},
                    {"role": "user", "content": user}]
        for attempt in range(2):
            resp = client.chat.completions.create(
                model=LLM["model"], temperature=0,
                response_format={"type": "json_object"}, messages=messages)
            try:
                out = json.loads(resp.choices[0].message.content or "")
            except ValueError:
                out = None
            if isinstance(out, dict) and all(v is not None for v in out.values()):
                return out
            messages.append({"role": "user", "content": "Fill every field with a real value, never null. Reply with JSON only."})
        return out if isinstance(out, dict) else None
    except Exception:
        return None


def tool_loop(system: str, user_text: str, tools: list, dispatch, max_iters: int = 6,
              required: tuple = ()) -> tuple[dict, list, str | None]:
    """Model-driven tool loop on the configured provider.
    Returns (tool outputs by name, call log, final text or None).
    Any failure → ({}, [], None) so callers fall back to rules."""
    try:
        provider = get_provider()
        if provider == "anthropic":
            return _tool_loop_claude(system, user_text, tools, dispatch, max_iters, required)
        if provider == "gemini":
            return _tool_loop_gemini(system, user_text, tools, dispatch, max_iters, required)
        if provider == "groq":
            return _tool_loop_groq(system, user_text, tools, dispatch, max_iters, required)
    except Exception:
        pass
    return {}, [], None


def _nudge(gathered: dict, required: tuple) -> str | None:
    missing = [t for t in required if t not in gathered]
    if not missing:
        return None
    return ("You still need to call these tools before answering: "
            + ", ".join(missing) + ". Call them now, no other text.")


def _tool_loop_claude(system: str, user_text: str, tools: list, dispatch, max_iters: int, required=()):
    client = _get_client()
    if client is None:
        return {}, [], None
    messages = [{"role": "user", "content": user_text}]
    gathered, calls = {}, []
    for _ in range(max_iters):
        resp = client.with_options(
            timeout=float(LLM["timeout_seconds"]), max_retries=0).messages.create(
            model=LLM["model"], max_tokens=int(LLM["max_tokens"]),
            system=system, tools=tools, messages=messages,
            output_config={"effort": LLM.get("effort", "low")})
        if resp.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for b in resp.content:
                if b.type == "tool_use":
                    out = dispatch(b.name, b.input)
                    gathered[b.name] = out
                    calls.append({"tool": b.name, "input": b.input})
                    results.append({"type": "tool_result", "tool_use_id": b.id,
                                    "content": json.dumps(out, default=str)[:20000]})
            messages.append({"role": "user", "content": results})
            continue
        if resp.stop_reason == "end_turn":
            text = "".join(b.text for b in resp.content if b.type == "text").strip()
            nudge = _nudge(gathered, required)
            if nudge:
                messages.append({"role": "assistant", "content": resp.content})
                messages.append({"role": "user", "content": nudge})
                continue
            return gathered, calls, text or None
        break
    return gathered, calls, None


def _tool_loop_gemini(system: str, user_text: str, tools: list, dispatch, max_iters: int, required=()):
    from google import genai
    decls = []
    for t in tools:
        schema = {k: v for k, v in t["input_schema"].items() if k != "additionalProperties"}
        decls.append({"name": t["name"], "description": t["description"], "parameters": schema})
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    contents: list = [{"role": "user", "parts": [{"text": user_text}]}]
    gathered, calls = {}, []
    for _ in range(max_iters):
        resp = client.models.generate_content(
            model=LLM["model"], contents=contents,
            config={"system_instruction": system, "temperature": 0,
                    "tools": [{"function_declarations": decls}]})
        parts = resp.candidates[0].content.parts
        made_calls = False
        replies = []
        for part in parts:
            fc = part.function_call
            if fc:
                made_calls = True
                args = dict(fc.args or {})
                out = dispatch(fc.name, args)
                gathered[fc.name] = out
                calls.append({"tool": fc.name, "input": args})
                replies.append({"function_response": {"name": fc.name, "response": {
                    "output": json.dumps(out, default=str)[:20000]}}})
        contents.append({"role": "model", "parts": parts})
        if not made_calls:
            text = "".join(getattr(part, "text", None) or "" for part in parts).strip()
            nudge = _nudge(gathered, required)
            if nudge:
                contents.append({"role": "user", "parts": [{"text": nudge}]})
                continue
            return gathered, calls, text or None
        contents.append({"role": "user", "parts": replies})
    return gathered, calls, None


def _tool_loop_groq(system: str, user_text: str, tools: list, dispatch, max_iters: int, required=()):
    client = _groq_client()
    oai_tools = [{"type": "function", "function": {
        "name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
        for t in tools]
    messages: list = [{"role": "system", "content": system},
                      {"role": "user", "content": user_text}]
    gathered, calls = {}, []
    for _ in range(max_iters):
        resp = client.chat.completions.create(
            model=LLM["model"], temperature=0, messages=messages, tools=oai_tools)
        msg = resp.choices[0].message
        tool_calls = msg.tool_calls or []
        if not tool_calls:
            nudge = _nudge(gathered, required)
            if nudge:
                messages.append({"role": "assistant", "content": msg.content or ""})
                messages.append({"role": "user", "content": nudge})
                continue
            return gathered, calls, (msg.content or "").strip() or None
        messages.append(msg)
        for tc in tool_calls:
            args = json.loads(tc.function.arguments or "{}")
            out = dispatch(tc.function.name, args)
            gathered[tc.function.name] = out
            calls.append({"tool": tc.function.name, "input": args})
            messages.append({"role": "tool", "tool_call_id": tc.id,
                             "content": json.dumps(out, default=str)[:20000]})
    return gathered, calls, None


def ask_json(system: str, user: str, schema: dict) -> dict | None:
    """One model call constrained to a JSON schema. None on any failure."""
    provider = get_provider()
    if provider == "gemini":
        return _ask_json_gemini(system, user, schema)
    if provider == "groq":
        return _ask_json_groq(system, user, schema)
    if provider != "anthropic":
        return None
    client = _get_client()
    if client is None:
        return None
    try:
        response = client.with_options(
            timeout=float(LLM["timeout_seconds"]), max_retries=0,
        ).messages.create(
            model=LLM["model"],
            max_tokens=int(LLM["max_tokens"]),
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": LLM.get("effort", "low"),
                "format": {"type": "json_schema", "schema": schema},
            },
        )
        if response.stop_reason != "end_turn":
            return None
        text = "".join(b.text for b in response.content if b.type == "text")
        return json.loads(text)
    except Exception:
        return None


# ── KPI retrieval ──────────────────────────────────────────────────────────────

def kpi_doc(division: str) -> str:
    """Retrieval step: pick the requesting department's KPI document."""
    path = KPI_DIR / f"{division}.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


# ── Priority suggestion ────────────────────────────────────────────────────────

def _days_left(deadline: str) -> int | None:
    try:
        return (datetime.strptime(deadline[:10], "%Y-%m-%d").date() - date.today()).days
    except ValueError:
        return None


def rule_priority(deadline: str) -> dict:
    days = _days_left(deadline)
    if days is not None and days <= 2:
        p, why = "High", f"the deadline is in {max(days, 0)} day(s)"
    elif days is not None and days <= 7:
        p, why = "Medium", f"the deadline is within a week ({days} days)"
    else:
        p, why = "Low", "the deadline is more than a week away"
    return {"priority": p, "reason": f"Rule-based: {why}, so {p}.", "method": "rule-based"}


_PRIORITY_SCHEMA = {
    "type": "object",
    "properties": {
        "priority": {"type": "string", "enum": list(PRIORITIES)},
        "reason": {"type": "string"},
    },
    "required": ["priority", "reason"],
    "additionalProperties": False,
}


def suggest_priority(title: str, description: str, division: str, deadline: str) -> dict:
    doc = kpi_doc(division)
    days = _days_left(deadline)
    system = (
        "You suggest a priority for a ticket sent to a data analytics team. "
        "Use the requesting department's KPI document and the deadline. "
        "Reply with a priority and one plain sentence of reason that names the KPI "
        "and the days to deadline, e.g. \"Finance month-end reporting is a top KPI, "
        "and the deadline is in 2 days, so High.\" A person confirms the final priority."
    )
    user = (
        f"Department: {division}\nToday: {date.today().isoformat()}\n"
        f"Deadline: {deadline} ({days} days away)\nTitle: {title}\n"
        f"Description: {description or '(none)'}\n\nKPI document:\n{doc}"
    )
    out = ask_json(system, user, _PRIORITY_SCHEMA)
    if out and out.get("priority") in PRIORITIES and isinstance(out.get("reason"), str) and out["reason"].strip():
        return {"priority": out["priority"], "reason": out["reason"].strip(), "method": "llm"}
    return rule_priority(deadline)


# ── Ticket-text extraction ─────────────────────────────────────────────────────

KEYWORDS: list[tuple[list[str], str]] = [
    (["attrition", "churn", "forecast", "predict", "model", "regression", "segmentation"], "Modelling"),
    (["dashboard", "visual", "power bi", "tableau", "looker", "chart"], "Dashboards"),
    (["script", "automate", "automation", "pipeline", "etl", "webhook", "export fix"], "Automation"),
    (["policy", "documentation", "procedure", "guide", "handbook"], "Documentation"),
    (["report", "variance", "reconciliation", "summary", "analysis", "survey", "breakdown"], "Reporting"),
]


def rule_category(title: str, description: str, known: list[str]) -> dict:
    text = f"{title} {description}".lower()
    for words, category in KEYWORDS:
        if any(re.search(rf"\b{re.escape(w)}", text) for w in words):
            conf = "High" if category in known else "Low"
            return {"category": category, "confidence": conf, "method": "rule-based"}
    return {"category": "Unclassified", "confidence": "Low", "method": "rule-based"}


def extract_category(title: str, description: str, known: list[str]) -> dict:
    """Map free text to a known category, or flag it as a type never seen before."""
    schema = {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": known + ["NEW"]},
            "new_type_label": {"type": "string"},
        },
        "required": ["category", "new_type_label"],
        "additionalProperties": False,
    }
    system = (
        "Classify an analytics ticket into one of the known categories. "
        "If it clearly doesn't fit any of them, answer NEW and give a short label "
        "for the new type in new_type_label; otherwise leave new_type_label empty."
    )
    out = ask_json(system, f"Known categories: {', '.join(known)}\nTitle: {title}\nDescription: {description or '(none)'}", schema)
    if out and out.get("category") in known:
        return {"category": out["category"], "confidence": "High", "method": "llm"}
    if out and out.get("category") == "NEW":
        label = (out.get("new_type_label") or "Unclassified").strip()[:40] or "Unclassified"
        return {"category": label, "confidence": "Low", "method": "llm"}
    return rule_category(title, description, known)
