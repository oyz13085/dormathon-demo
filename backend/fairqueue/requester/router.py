"""Requester API, mounted at /requester.

The demo has no login: `requester` / `user` is the identity chosen in the app's role switcher.
"""
from __future__ import annotations
from typing import Literal, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from fairqueue import config
from fairqueue.requester import service, store

router = APIRouter(dependencies=[Depends(store.ensure_schema)])


class ReviewIn(BaseModel):
    requester: str
    rating: Literal["Useful", "Needs revision"]
    note: Optional[str] = None


@router.get("/completed-work")
def completed_work(requester: str = Query(..., min_length=1)):
    """The requester's delivered work: every version, its review history and revision requests."""
    return service.completed_work_for(requester)


@router.post("/deliverables/{deliverable_id}/reviews", status_code=201)
def review(deliverable_id: int, body: ReviewIn):
    """Add a review to the newest version. Earlier reviews are kept; Needs revision reopens the ticket."""
    return service.review(deliverable_id, body.requester, body.rating, body.note)


@router.post("/deliverables/{deliverable_id}/revision-requests", status_code=201)
async def revision_request(
    deliverable_id: int,
    requester: str = Form(...),
    reason: str = Form(...),
    problem: str = Form(...),
    requested_changes: str = Form(...),
    location: Optional[str] = Form(None),
    files: list[UploadFile] = File(default=[]),
):
    """Ask for changes, including after marking the work Useful. Attachments are optional."""
    return await service.request_revision(deliverable_id, requester, reason, problem, location,
                                          requested_changes, files)


@router.get("/tickets/{ticket_id}/revision-requests")
def ticket_revision_requests(ticket_id: int, user: str = Query(..., min_length=1)):
    """For the requester and the assigned analyst: what was asked, oldest first, with attachments."""
    service.check_ticket_reader(ticket_id, user)
    return [service.public_request(r, user) for r in store.revision_requests_where("ticket_id", [ticket_id])]


@router.get("/revision-attachments/{attachment_id}")
def revision_attachment(attachment_id: int, user: str = Query(..., min_length=1)):
    a = store.get_attachment(attachment_id)
    if a is None:
        raise HTTPException(404, "Attachment not found")
    service.check_ticket_reader(a["ticket_id"], user)
    root = config.UPLOADS_DIR.resolve()
    path = (root / a["file_path"].removeprefix("uploads/")).resolve()
    if root not in path.parents or not path.exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path, filename=a["file_name"])
