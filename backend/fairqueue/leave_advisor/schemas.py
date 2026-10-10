"""Typed requests and responses. Response models also act as a privacy filter: only declared fields leave the API."""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


class LeaveInput(BaseModel):
    analyst_id: int
    start_date: str
    end_date: str
    hours_left: dict[int, float] = Field(default_factory=dict)    # optional, own In progress tickets only


class LeaveSubmit(LeaveInput):
    reason: Optional[str] = None
    # Per affected ticket: keep it (default) or propose handing it to the recommended colleague
    choices: dict[int, Literal["keep", "reassign"]] = Field(default_factory=dict)


class Person(BaseModel):
    id: int
    name: str
    role: Optional[str]


class SuitabilityPart(BaseModel):
    key: Literal["skills", "experience", "domain", "capacity", "deadline"]
    label: str
    value: Optional[float]           # 0–1; None = insufficient data
    weight: float


class Suitability(BaseModel):
    score: Optional[int]             # 0–100, rule-based from the parts below; not produced by the AI
    method: Literal["rule-based"]
    parts: list[SuitabilityPart]
    skills: dict
    experience: dict
    capacity: dict


class Suggestion(BaseModel):
    ticket_id: int
    title: str
    deadline: str
    priority: str
    status: str
    impact: str
    recommended: Optional[Person]
    suitability: Optional[Suitability] = None
    reason: str
    urgency: dict                                   # level (the ticket's priority), risk if kept, why it's urgent
    projected_completion: Optional[str] = None      # if reassigned to the recommended colleague
    projected_if_kept: Optional[str] = None
    proposed_revised_deadline: Optional[str] = None  # only a proposal; the official deadline never changes here
    suggested_deadline: Optional[str] = None         # original date if the forecast meets it, else the forecast; None = no forecast
    team_effect: Optional[dict] = None              # colleague's hours now/after, their tickets pushed at risk
    decided_by: Literal["ai", "rule_based", "rejected", "blocked"]   # rejected = the AI's pick failed the checks
    handover_feasible: Literal["yes", "no", "unknown"]


class AIStatus(BaseModel):
    status: Literal["ok", "unavailable", "disabled", "not_needed"]
    provider: str
    reason: Optional[str]
    model: Optional[str]
    reused: bool = False             # earlier AI picks re-checked against new data, without a new AI call
    request_ids: list[str]           # provider request ID of every AI call, for checking a live request
    turns: int


class Suggestions(BaseModel):
    valid: bool
    errors: list[str]
    warnings: list[str]
    leave: Optional[dict] = None
    calendar: Optional[dict] = None
    source: Optional[Literal["ai", "rule_based", "none_needed"]] = None
    ai: Optional[AIStatus] = None
    tickets: list[Suggestion] = Field(default_factory=list)
    stats: Optional[dict] = None
    reassigned: list[dict] = Field(default_factory=list)                       # handovers already made for this leave
    note: Optional[str] = None
    cached: bool = False
    choices: dict[int, Literal["keep", "reassign"]] = Field(default_factory=dict)   # set on submitted plans
    proposed_handovers: list[dict] = Field(default_factory=list)                    # reassign choices, for the lead


class ReassignIn(LeaveInput):
    ticket_id: int
    to_analyst_id: int
    user: str = Field(min_length=1)            # the analyst making the handover (demo identity)


class Reassigned(BaseModel):
    ticket: dict
    handover_id: int
    to: Person
    decided_by_ai: bool
    suggestions: Suggestions                   # recalculated after the change


class Submitted(BaseModel):
    leave: dict
    plan_id: int
    whatif: dict            # the existing what-if, so the current confirmation message keeps working
    proposed_handovers: list[dict]
    reassigned: Literal[False] = False


class StoredPlan(BaseModel):
    id: int
    leave_id: int
    analyst_id: int
    status: Literal["Proposed"]
    plan: Suggestions
    hours_left: dict[int, float]
    created_at: str
