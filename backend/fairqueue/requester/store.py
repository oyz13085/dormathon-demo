"""SQL for the requester module.

Its own tables (schema.sql) are append-only history. Shared tables are read freely and written in only
two places the review lifecycle already owns: the deliverable's current-review columns, which other
modules read, and reopening a closed ticket.
"""
from __future__ import annotations
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator
from fairqueue.db import repo

SCHEMA = Path(__file__).with_name("schema.sql")
TABLES = ("revision_attachments", "revision_requests", "deliverable_reviews")   # drop order


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(repo.DB_PATH, timeout=10)    # read at call time, so tests can point it elsewhere
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """One write transaction. BEGIN IMMEDIATE takes the write lock up front, so two submissions for the
    same deliverable can't both pass their checks."""
    con = _connect()
    con.isolation_level = None
    try:
        con.execute("BEGIN IMMEDIATE")
        yield con
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def _rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    con = _connect()
    try:
        return [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()


# Deliverables whose current rating isn't the latest entry in the history yet
_LEGACY_PENDING = """
    FROM deliverables d
    WHERE d.requester_rating IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM deliverable_reviews r
        WHERE r.id = (SELECT MAX(id) FROM deliverable_reviews WHERE deliverable_id = d.id)
          AND r.rating = d.requester_rating
          AND COALESCE(r.note, '') = COALESCE(d.revision_note, ''))
"""


def ensure_schema() -> None:
    """Create the tables if a reseed dropped them, then import any rating written outside this module.
    Checks read-only first, so ordinary requests don't take the write lock."""
    con = _connect()
    try:
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        needed = not set(TABLES) <= have or con.execute("SELECT 1 " + _LEGACY_PENDING + " LIMIT 1").fetchone()
    finally:
        con.close()
    if not needed:
        return
    with transaction() as con:
        # Statement by statement: executescript() would commit and end this transaction
        lines = SCHEMA.read_text(encoding="utf-8").splitlines()
        sql = "\n".join(line.split("--")[0] for line in lines)    # drop comments, which contain semicolons
        for stmt in sql.split(";"):
            if stmt.strip():
                con.execute(stmt)
        # Ratings set directly on deliverables (the seed, or the older PATCH /deliverables/{id}/rate) are
        # copied into the history once, marked 'legacy' with no time rather than a made-up one
        con.execute("""INSERT INTO deliverable_reviews (deliverable_id, rating, note, reviewed_by, source, created_at)
                       SELECT d.id, d.requester_rating, d.revision_note, NULL, 'legacy', NULL """ + _LEGACY_PENDING)


# ── Reads ──────────────────────────────────────────────────────────────────────

_DELIVERABLE = """
    SELECT d.*, t.title AS ticket_title, t.division, t.category, t.requester, t.status AS ticket_status,
           t.assignee_id, t.description AS ticket_description, a.name AS analyst_name,
           (SELECT name FROM analysts WHERE id = t.assignee_id) AS assignee_name,
           (SELECT MAX(version) FROM deliverables WHERE ticket_id = d.ticket_id) AS latest_version
    FROM deliverables d JOIN tickets t ON t.id = d.ticket_id
    LEFT JOIN analysts a ON a.id = d.uploaded_by
"""


def get_deliverable(con: sqlite3.Connection, deliverable_id: int) -> dict | None:
    row = con.execute(_DELIVERABLE + " WHERE d.id = ?", (deliverable_id,)).fetchone()
    return dict(row) if row else None


def deliverables_for_requester(requester: str) -> list[dict]:
    return _rows(_DELIVERABLE + " WHERE t.requester = ? ORDER BY d.ticket_id, d.version DESC", (requester,))


def ticket_access(ticket_id: int) -> dict | None:
    rows = _rows("""SELECT t.id, t.requester, t.status, a.name AS assignee_name FROM tickets t
                    LEFT JOIN analysts a ON a.id = t.assignee_id WHERE t.id = ?""", (ticket_id,))
    return rows[0] if rows else None


def reviews_for(deliverable_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {i: [] for i in deliverable_ids}
    if not deliverable_ids:
        return out
    marks = ",".join("?" * len(deliverable_ids))
    for r in _rows(f"SELECT * FROM deliverable_reviews WHERE deliverable_id IN ({marks}) ORDER BY id",
                   tuple(deliverable_ids)):
        out[r["deliverable_id"]].append(r)
    return out


def revision_requests_where(column: str, values: list[int]) -> list[dict]:
    """Revision requests (oldest first) with their attachments, by deliverable_id or ticket_id."""
    assert column in ("deliverable_id", "ticket_id")
    if not values:
        return []
    marks = ",".join("?" * len(values))
    reqs = _rows(f"SELECT * FROM revision_requests WHERE {column} IN ({marks}) ORDER BY id", tuple(values))
    if reqs:
        ids = [r["id"] for r in reqs]
        atts = _rows(f"""SELECT id, revision_request_id, file_name, file_type, size_bytes, uploaded_at
                         FROM revision_attachments WHERE revision_request_id IN ({','.join('?' * len(ids))})
                         ORDER BY id""", tuple(ids))
        for r in reqs:
            r["attachments"] = [a for a in atts if a["revision_request_id"] == r["id"]]
    return reqs


def get_attachment(attachment_id: int) -> dict | None:
    rows = _rows("""SELECT ra.*, rr.ticket_id FROM revision_attachments ra
                    JOIN revision_requests rr ON rr.id = ra.revision_request_id WHERE ra.id = ?""", (attachment_id,))
    return rows[0] if rows else None


# ── Writes (inside a transaction) ──────────────────────────────────────────────

def add_review(con: sqlite3.Connection, deliverable_id: int, rating: str, note: str | None, by: str) -> int:
    """Append to the history, then mirror it as the deliverable's current review."""
    cur = con.execute("""INSERT INTO deliverable_reviews (deliverable_id, rating, note, reviewed_by, source, created_at)
                         VALUES (?, ?, ?, ?, 'requester', ?)""", (deliverable_id, rating, note, by, now()))
    con.execute("UPDATE deliverables SET requester_rating = ?, revision_note = ? WHERE id = ?",
                (rating, note, deliverable_id))
    return int(cur.lastrowid)


def reopen_ticket(con: sqlite3.Connection, ticket_id: int) -> bool:
    """Closed → In progress, the same change the existing lifecycle makes. False if it wasn't closed."""
    cur = con.execute("UPDATE tickets SET status = 'In progress', closed_at = NULL WHERE id = ? AND status = 'Closed'",
                      (ticket_id,))
    return cur.rowcount == 1


def add_revision_request(con: sqlite3.Connection, review_id: int, d: dict, reason: str, problem: str,
                         location: str | None, requested_changes: str, by: str) -> int:
    cur = con.execute("""INSERT INTO revision_requests (review_id, deliverable_id, ticket_id, reason, problem,
                                                        location, requested_changes, created_by, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                      (review_id, d["id"], d["ticket_id"], reason, problem, location, requested_changes, by, now()))
    return int(cur.lastrowid)


def add_attachment(con: sqlite3.Connection, request_id: int, file_name: str, file_path: str,
                   file_type: str, size_bytes: int) -> int:
    cur = con.execute("""INSERT INTO revision_attachments (revision_request_id, file_name, file_path, file_type,
                                                           size_bytes, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)""",
                      (request_id, file_name, file_path, file_type, size_bytes, now()))
    return int(cur.lastrowid)
