"""Requester rules: who may review what, revision requests with attachments, and completed-work history."""
from __future__ import annotations
import re
import shutil
import uuid
from dataclasses import dataclass
from fastapi import HTTPException, UploadFile
from fairqueue import config
from fairqueue.requester import store

REASONS = {
    "fix_issue": "Fix an error or issue",
    "clarify_improve": "Clarify or improve existing work",
    "additional_changes": "Request additional changes",
}

MAX_FILES = 5
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
# Extension → leading bytes the content must start with (None: text, checked separately)
SIGNATURES: dict[str, tuple[bytes, ...] | None] = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "pdf": (b"%PDF",),
    "xlsx": (b"PK\x03\x04",),     # xlsx is a zip archive
    "csv": None,
}


# ── Reviewing ──────────────────────────────────────────────────────────────────

def check_can_review(d: dict | None, requester: str, rating: str) -> dict:
    """Only the ticket's requester, only the newest version, only while the ticket is closed, and one
    Useful per version. Needs revision is allowed on an unreviewed or Useful version."""
    if d is None:
        raise HTTPException(404, "Deliverable not found")
    if d["requester"] != requester:
        raise HTTPException(403, "Only the person who requested this ticket can review its work")
    if d["version"] != d["latest_version"]:
        raise HTTPException(409, f"Only the newest version (version {d['latest_version']}) can be reviewed")
    if d["ticket_status"] != "Closed":
        raise HTTPException(409, "This ticket is open again; review the next version once it's delivered")
    current = d["requester_rating"]
    if rating == "Useful" and current is not None:
        raise HTTPException(409, f"This version has already been reviewed ({current})")
    if rating == "Needs revision" and current == "Needs revision":
        raise HTTPException(409, "A revision has already been requested for this version")
    return d


def review(deliverable_id: int, requester: str, rating: str, note: str | None) -> dict:
    note = (note or "").strip() or None
    if rating == "Needs revision" and not note:
        raise HTTPException(400, "Say what needs to change")
    with store.transaction() as con:
        d = check_can_review(store.get_deliverable(con, deliverable_id), requester, rating)
        review_id = store.add_review(con, deliverable_id, rating, note, requester)
        if rating == "Needs revision" and not store.reopen_ticket(con, d["ticket_id"]):
            raise HTTPException(409, "The ticket is no longer closed")
    return {"review_id": review_id, **completed_work_for(requester, ticket_id=d["ticket_id"])}


# ── Revision requests ──────────────────────────────────────────────────────────

@dataclass
class _Upload:
    name: str
    ext: str
    data: bytes


def _safe_name(raw: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", raw.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]).strip(" .")
    return name[:120] or "attachment"


async def _read_uploads(files: list[UploadFile]) -> list[_Upload]:
    """Server-side checks that don't trust the browser: count, extension, real content type and size."""
    files = [f for f in files if f is not None and f.filename]
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Attach at most {MAX_FILES} files")
    out, total = [], 0
    for f in files:
        name = _safe_name(f.filename or "")
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in SIGNATURES:
            raise HTTPException(415, f"{name}: only PNG, JPG, PDF, CSV and XLSX files can be attached")
        data = await f.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, f"{name} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB")
        if not data:
            raise HTTPException(400, f"{name} is empty")
        signatures = SIGNATURES[ext]
        if signatures is None:
            if b"\x00" in data[:4096]:
                raise HTTPException(415, f"{name} doesn't look like a CSV text file")
        elif not data.startswith(signatures):
            raise HTTPException(415, f"{name} doesn't look like a real .{ext} file")
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(413, f"Attachments can total at most {MAX_TOTAL_BYTES // (1024 * 1024)} MB")
        out.append(_Upload(name, ext, data))
    names = [u.name.lower() for u in out]
    if len(set(names)) != len(names):
        raise HTTPException(400, "Two attachments have the same name")
    return out


def _current_note(reason: str, problem: str, location: str | None, changes: str, n_files: int) -> str:
    """The one-line version stored as the deliverable's current revision note, which the analyst's
    existing views already show. The structured request is kept in revision_requests."""
    parts = [f"{REASONS[reason]}. Problem: {problem}", f"Changes wanted: {changes}"]
    if location:
        parts.append(f"Look at: {location}")
    if n_files:
        parts.append(f"{n_files} attachment{'s' if n_files != 1 else ''}")
    return ". ".join(p.rstrip(".") for p in parts) + "."


async def request_revision(deliverable_id: int, requester: str, reason: str, problem: str,
                           location: str | None, requested_changes: str, files: list[UploadFile]) -> dict:
    problem, requested_changes = (problem or "").strip(), (requested_changes or "").strip()
    location = (location or "").strip() or None
    if reason not in REASONS:
        raise HTTPException(400, f"reason must be one of {', '.join(REASONS)}")
    if not problem:
        raise HTTPException(400, "Describe the problem")
    if not requested_changes:
        raise HTTPException(400, "Describe the changes you want")
    uploads = await _read_uploads(files)

    # Files go to a fresh folder first; if the database step fails, the folder is removed again
    folder_name = uuid.uuid4().hex
    folder = config.UPLOADS_DIR / "revisions" / folder_name
    try:
        if uploads:
            folder.mkdir(parents=True)
            for u in uploads:
                (folder / u.name).write_bytes(u.data)
        with store.transaction() as con:
            d = check_can_review(store.get_deliverable(con, deliverable_id), requester, "Needs revision")
            note = _current_note(reason, problem, location, requested_changes, len(uploads))
            review_id = store.add_review(con, deliverable_id, "Needs revision", note, requester)
            request_id = store.add_revision_request(con, review_id, d, reason, problem, location,
                                                    requested_changes, requester)
            for u in uploads:
                store.add_attachment(con, request_id, u.name, f"uploads/revisions/{folder_name}/{u.name}",
                                     u.ext, len(u.data))
            if not store.reopen_ticket(con, d["ticket_id"]):
                raise HTTPException(409, "The ticket is no longer closed")
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    saved = store.revision_requests_where("deliverable_id", [deliverable_id])
    req = next(r for r in saved if r["id"] == request_id)
    access = store.ticket_access(d["ticket_id"])
    return {"revision_request": public_request(req, requester),
            "ticket": {"id": d["ticket_id"], "status": access["status"] if access else None}}


# ── Reads ──────────────────────────────────────────────────────────────────────

def public_request(r: dict, user: str) -> dict:
    from urllib.parse import quote
    return {
        "id": r["id"], "review_id": r["review_id"], "deliverable_id": r["deliverable_id"], "ticket_id": r["ticket_id"],
        "reason": r["reason"], "reason_label": REASONS[r["reason"]], "problem": r["problem"],
        "location": r["location"], "requested_changes": r["requested_changes"],
        "created_by": r["created_by"], "created_at": r["created_at"],
        "attachments": [{
            "id": a["id"], "file_name": a["file_name"], "file_type": a["file_type"], "size_bytes": a["size_bytes"],
            "url": f"/requester/revision-attachments/{a['id']}?user={quote(user)}",
        } for a in r.get("attachments", [])],
    }


_VERSION_FIELDS = ("id", "ticket_id", "version", "kind", "title", "file_name", "file_type", "url", "summary",
                   "uploaded_at", "analyst_name", "requester_rating", "revision_note")


def completed_work_for(requester: str, ticket_id: int | None = None) -> dict:
    """Every ticket with delivered work, each with all its versions (newest first), every review of each
    version (oldest first) and any revision requests with their attachments."""
    rows = [d for d in store.deliverables_for_requester(requester) if ticket_id is None or d["ticket_id"] == ticket_id]
    ids = [d["id"] for d in rows]
    reviews = store.reviews_for(ids)
    requests: dict[int, list[dict]] = {i: [] for i in ids}
    for r in store.revision_requests_where("deliverable_id", ids):
        requests[r["deliverable_id"]].append(public_request(r, requester))

    tickets: dict[int, dict] = {}
    for d in rows:
        t = tickets.setdefault(d["ticket_id"], {
            "ticket_id": d["ticket_id"], "title": d["ticket_title"], "division": d["division"],
            "category": d["category"], "description": d["ticket_description"], "status": d["ticket_status"],
            "assignee_name": d["assignee_name"],
            "versions": [],
        })
        version = {k: d[k] for k in _VERSION_FIELDS}
        version["file_url"] = f"/deliverables/{d['id']}/open" if d["kind"] == "File" else None
        version["review_status"] = d["requester_rating"] or "Awaiting review"
        version["reviews"] = [{k: r[k] for k in ("id", "rating", "note", "reviewed_by", "source", "created_at")}
                              for r in reviews[d["id"]]]
        version["revision_requests"] = requests[d["id"]]
        t["versions"].append(version)
    items = sorted(tickets.values(), key=lambda t: t["versions"][0]["uploaded_at"], reverse=True)
    return {"requester": requester, "items": items}


def check_ticket_reader(ticket_id: int, user: str) -> dict:
    """The requester and the assigned analyst can read a ticket's revision requests and their files."""
    t = store.ticket_access(ticket_id)
    if t is None:
        raise HTTPException(404, "Ticket not found")
    if user not in (t["requester"], t["assignee_name"]):
        raise HTTPException(403, "Only the requester and the assigned analyst can see this")
    return t
