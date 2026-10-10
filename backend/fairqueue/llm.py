"""
Language tasks: priority suggestion (RAG over KPI docs), ticket-text extraction,
and one-sentence explanations.

The LLM only ever suggests. Every call has a rule-based fallback, labelled
"rule-based", used when there is no API key, the call is slow, fails, or
returns invalid JSON. Outputs are cached in agent_cache by the caller.
"""
from __future__ import annotations
import json
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


def ask_json(system: str, user: str, schema: dict) -> dict | None:
    """One Claude call constrained to a JSON schema. None on any failure."""
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
