"""
Request bodies for the API. Responses are plain JSON built by the engines;
web/src/api/types.ts describes them for the frontend. Keep the two in sync.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field

Dept = Literal["HR", "IT", "Finance", "Marketing"]
Priority = Literal["Low", "Medium", "High", "Critical"]
Role = Literal["requester", "analyst", "lead"]


class SuggestRequest(BaseModel):
    title: str
    division: Dept
    deadline: str
    requester: str
    description: Optional[str] = None


class TicketCreate(BaseModel):
    title: str
    division: Dept
    deadline: str
    requester: str
    priority: Priority
    description: Optional[str] = None
    category: Optional[str] = None             # from the suggestion; re-extracted if missing
    suggested_priority: Optional[Priority] = None
    assignee_id: Optional[int] = None          # requester confirming a high-confidence suggestion
    override_reason: Optional[str] = None


class StatusChange(BaseModel):
    status: Literal["In progress", "Waiting"]
    by: Optional[str] = None


class PriorityChange(BaseModel):
    priority: Priority
    reason: Optional[str] = None
    by: Optional[str] = "lead"


class FeedbackIn(BaseModel):
    given_by: str
    role: Literal["analyst", "lead"]
    actual_hours: Optional[float] = None
    estimate_rating: Optional[Literal["Too low", "About right", "Too high"]] = None
    better_suited_id: Optional[int] = None
    comment: Optional[str] = None


class RatingIn(BaseModel):
    rating: Literal["Useful", "Needs revision"]
    note: Optional[str] = None
    by: Optional[str] = None


class AssignRequest(BaseModel):
    ticket_id: int
    analyst_id: int
    override_reason: Optional[str] = None
    support_id: Optional[int] = None
    decided_by: Optional[str] = "lead"


class FitWeights(BaseModel):
    w_skill: float = Field(0.35, ge=0, le=1)
    w_track: float = Field(0.20, ge=0, le=1)
    w_pairing: float = Field(0.15, ge=0, le=1)
    w_capacity: float = Field(0.15, ge=0, le=1)
    w_deadline: float = Field(0.15, ge=0, le=1)
    good_fit: float = Field(70, ge=0, le=100)
    poor_fit: float = Field(50, ge=0, le=100)
    updated_by: Optional[str] = "lead"


class SkillAdjustmentIn(BaseModel):
    analyst_id: int
    category: str
    adjustment: float = Field(..., ge=-1, le=1)
    reason: Optional[str] = None
    set_by: str
    role: Literal["analyst", "lead"]


class ApprovalIn(BaseModel):
    approved: bool


class LeaveIn(BaseModel):
    analyst_id: int
    start_date: str
    end_date: str
    reason: Optional[str] = None


class LeaveDecision(BaseModel):
    status: Literal["Approved", "Rejected"]
