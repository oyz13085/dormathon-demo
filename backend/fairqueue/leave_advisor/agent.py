"""
AI handover agent on Groq: a bounded, read-only tool loop, then one structured answer.

  1. Tool rounds (up to ai.max_tool_rounds): the model reads FairQueue's records through four read-only tools.
     It never gets tools that approve leave, change assignments or edit tickets.
  2. One final request with Groq structured outputs (strict JSON schema), validated again with Pydantic.
     Groq doesn't allow tools and structured outputs in the same request, so the records gathered in step 1
     are passed to this request as context.

The backend re-checks every choice afterwards (plan.validate_choices), so an unknown, ineligible or
over-booked analyst can't get through. Every failure returns AgentFailure; the caller then shows a labelled
rule-based fallback. The key comes from GROQ_API_KEY (backend/.env, loaded by fairqueue.config).
"""
from __future__ import annotations
import json
import logging
import os
from dataclasses import dataclass
from typing import Callable, Literal, Optional
from pydantic import BaseModel, ValidationError
from fairqueue.leave_advisor import impact

log = logging.getLogger("fairqueue.leave_advisor.agent")
MAX_WAIT = 15            # seconds: the longest rate-limit wait worth sitting through before falling back


# ── The structured answer ──────────────────────────────────────────────────────

class Decision(BaseModel):
    affected_ticket_id: int
    deadline: str
    short_impact_explanation: str
    recommended_analyst_id: Optional[int]
    short_recommendation_reason: str
    handover_feasible: Literal["yes", "no", "unknown"]


class HandoverAnswer(BaseModel):
    decisions: list[Decision]


ANSWER_SCHEMA = {          # Groq strict mode: every property required, nullable via a type list
    "type": "object",
    "properties": {"decisions": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "affected_ticket_id": {"type": "integer"},
            "deadline": {"type": "string"},
            "short_impact_explanation": {"type": "string"},
            "recommended_analyst_id": {"type": ["integer", "null"]},
            "short_recommendation_reason": {"type": "string"},
            "handover_feasible": {"type": "string", "enum": ["yes", "no", "unknown"]},
        },
        "required": ["affected_ticket_id", "deadline", "short_impact_explanation", "recommended_analyst_id",
                     "short_recommendation_reason", "handover_feasible"],
        "additionalProperties": False}}},
    "required": ["decisions"],
    "additionalProperties": False,
}


# ── Read-only tools ────────────────────────────────────────────────────────────

def _tool(name: str, description: str, props: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": props, "required": required, "additionalProperties": False}}}


TOOLS = [
    _tool("get_affected_tickets",
          "The leave requester's active tickets that the leave affects, with deadline, priority, status, remaining "
          "work and the IDs of colleagues eligible to take each one over. Read-only.", {}, []),
    _tool("get_eligible_analysts",
          "Colleagues eligible to take over one affected ticket: active, not the requester, and able to work before "
          "its deadline. Read-only.", {"ticket_id": {"type": "integer"}}, ["ticket_id"]),
    _tool("get_analyst_skills_and_experience",
          "One colleague's role, declared skills, closed tickets of the ticket's type and for its department. Read-only.",
          {"analyst_id": {"type": "integer"}, "ticket_id": {"type": "integer"}}, ["analyst_id", "ticket_id"]),
    _tool("get_analyst_capacity",
          "One colleague's booked hours now and after taking this ticket (handover overhead included), whether they "
          "would still meet its deadline without pushing their own tickets at risk, and whether they have pending "
          "leave that may overlap. List in also_taking any other affected tickets you plan to give the same "
          "colleague, so the check covers their combined workload. Read-only.",
          {"analyst_id": {"type": "integer"}, "ticket_id": {"type": "integer"},
           "also_taking": {"type": "array", "items": {"type": "integer"}}},
          ["analyst_id", "ticket_id", "also_taking"]),
]

SYSTEM = (
    "You help an analyst at a data analytics team who is requesting leave. For each ticket the leave affects, "
    "choose the ONE colleague best placed to take it over, or none. Use the tools to read FairQueue's records. "
    "Base every choice on the records only: relevant skills, similar ticket experience, current workload, capacity "
    "and availability before the deadline. Choose only from that ticket's eligible analyst IDs, and only someone "
    "whose capacity check says they fit. When you give one colleague several tickets, call get_analyst_capacity "
    "with the others in also_taking to check the combined workload. If nobody qualifies, use null. Never invent "
    "numbers, scores, skills, experience or ticket details. Keep each explanation to one or two short sentences "
    "that cite the records: short_recommendation_reason must name the colleague's relevant experience (closed "
    "tickets of this type or for this department, or a listed skill) and their capacity or finish date before the "
    "deadline. Write plain English for the analyst: never quote field names, write dates like 14 Oct, and keep "
    "experience (closed tickets) separate from declared skills. Refer to colleagues by name, never as he or she. Your answer is a proposal for the Team Lead, who approves the leave and makes any "
    "reassignment."
)
FINAL = ("You have looked up the records above. Now give your final answer: one decision for every affected "
         "ticket, as JSON matching the schema. Use only the records shown.")


@dataclass
class AgentResult:
    answer: HandoverAnswer
    request_ids: list[str]
    model: str
    turns: int


@dataclass
class AgentFailure:
    reason: str
    request_ids: list[str]


def _ai() -> dict:
    return impact.CONFIG["ai"]          # read at call time, so config changes apply


def make_client():
    """A Groq client with no SDK retries, or (None, why) when it can't be used."""
    try:
        from groq import Groq
    except ImportError:
        return None, "The groq Python package isn't installed (pip install groq)."
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        return None, "No Groq API key is configured (set GROQ_API_KEY in backend/.env)."
    return Groq(api_key=key, max_retries=0, timeout=float(_ai()["timeout_seconds"])), None


def _request_id(response) -> str | None:
    """Groq's request ID (x_groq.id) if present, otherwise the completion ID."""
    x = getattr(response, "x_groq", None)
    return getattr(x, "id", None) or getattr(response, "id", None)


def _create(client, **kw):
    """One request, retried once after a short rate-limit wait (Groq's retry-after, at most MAX_WAIT seconds)."""
    import time
    import groq
    try:
        return client.chat.completions.create(**kw)
    except groq.BadRequestError as e:
        # Groq's structured outputs can fail validation now and then (code json_validate_failed); its docs say to retry
        body = e.body if isinstance(e.body, dict) else {}
        if (body.get("error") or {}).get("code") != "json_validate_failed" or "response_format" not in kw:
            raise
        log.info("leave advisor: Groq structured output failed validation, retrying once")
        return client.chat.completions.create(**kw)
    except groq.RateLimitError as e:
        try:
            wait = float(e.response.headers.get("retry-after", ""))
        except (TypeError, ValueError, AttributeError):
            raise e
        if not 0 <= wait <= MAX_WAIT:
            raise
        log.info("leave advisor: Groq rate limit, retrying once in %.0fs", wait)
        time.sleep(wait)
        return client.chat.completions.create(**kw)


def run(context: str, dispatch: Callable[[str, dict], dict], client=None) -> AgentResult | AgentFailure:
    """Run the loop. `dispatch(name, input)` executes a read-only tool. `client` is injectable for tests."""
    import groq
    if client is None:
        client, why = make_client()
        if client is None:
            return AgentFailure(why, [])
    model, request_ids, turns = _ai()["model"], [], 0
    common = {"model": model, "max_completion_tokens": int(_ai()["max_completion_tokens"]), "temperature": 0}
    if _ai().get("reasoning_effort"):
        common["reasoning_effort"] = _ai()["reasoning_effort"]
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": context}]
    looked_up: list[dict] = []
    try:
        # 1. Tool rounds
        for _ in range(int(_ai()["max_tool_rounds"])):
            response = _create(client, messages=messages, tools=TOOLS, tool_choice="auto", **common)
            turns += 1
            request_ids.append(_request_id(response))
            choice = response.choices[0]
            log.info("leave advisor: Groq request %s (turn %d, finish %s)", request_ids[-1], turns, choice.finish_reason)
            calls = choice.message.tool_calls or []
            if not calls:
                break
            messages.append({"role": "assistant", "content": choice.message.content or "", "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in calls]})
            for c in calls:
                try:
                    args = json.loads(c.function.arguments or "{}")
                    out = dispatch(c.function.name, args)
                except Exception as e:                       # bad input becomes a tool error, not a crash
                    out = {"error": str(e)}
                looked_up.append({"tool": c.function.name, "input": c.function.arguments, "result": out})
                messages.append({"role": "tool", "tool_call_id": c.id, "name": c.function.name,
                                 "content": json.dumps(out, default=str)})

        # 2. One structured answer, with the records gathered above as context (no tools in this request)
        final_messages = [{"role": "system", "content": SYSTEM},
                          {"role": "user", "content": context + "\n\nRecords you looked up:\n"
                                                        + json.dumps(looked_up, separators=(",", ":"), default=str)},
                          {"role": "user", "content": FINAL}]
        response = _create(
            client, messages=final_messages, **common,
            response_format={"type": "json_schema",
                             "json_schema": {"name": "handover_answer", "strict": True, "schema": ANSWER_SCHEMA}})
        turns += 1
        request_ids.append(_request_id(response))
        choice = response.choices[0]
        log.info("leave advisor: Groq request %s (final, finish %s)", request_ids[-1], choice.finish_reason)
        if choice.finish_reason == "length":
            return AgentFailure("The AI's answer was cut off.", request_ids)
        try:
            answer = HandoverAnswer.model_validate_json(choice.message.content or "")
        except ValidationError as e:
            return AgentFailure(f"The AI's answer didn't match the expected format ({e.error_count()} problems).", request_ids)
        return AgentResult(answer, request_ids, getattr(response, "model", model), turns)
    except groq.APITimeoutError:
        return AgentFailure("The Groq API timed out.", request_ids)
    except groq.AuthenticationError:
        return AgentFailure("The Groq API rejected the key (check GROQ_API_KEY).", request_ids)
    except groq.RateLimitError:
        return AgentFailure("The Groq API is rate limited right now.", request_ids)
    except groq.APIStatusError as e:
        return AgentFailure(f"The Groq API returned an error ({e.status_code}).", request_ids)
    except groq.APIConnectionError:
        return AgentFailure("Couldn't reach the Groq API.", request_ids)
