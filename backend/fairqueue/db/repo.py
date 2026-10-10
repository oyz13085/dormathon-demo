"""Database access layer. All SQL lives here; dashboards and engines call these functions."""
from __future__ import annotations
import json
import os
import sqlite3
from datetime import datetime
from typing import Any

DB_PATH = os.getenv("DB_PATH", "fairqueue.db")
OPEN_STATUSES = ("Unassigned", "Assigned", "In progress", "Waiting")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def _rows(query: str, params: tuple = ()) -> list[dict[str, Any]]:
    with _connect() as con:
        return [dict(r) for r in con.execute(query, params).fetchall()]


def _one(query: str, params: tuple = ()) -> dict[str, Any] | None:
    with _connect() as con:
        row = con.execute(query, params).fetchone()
        return dict(row) if row else None


def _exec(query: str, params: tuple = ()) -> int:
    with _connect() as con:
        cur = con.execute(query, params)
        con.commit()
        return cur.lastrowid or 0


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ── Analysts ───────────────────────────────────────────────────────────────────

def get_analysts(active_only: bool = True) -> list[dict]:
    return _rows("SELECT * FROM analysts" + (" WHERE active=1" if active_only else "") + " ORDER BY id")


def get_analyst(analyst_id: int | None) -> dict | None:
    if analyst_id is None:
        return None
    return _one("SELECT * FROM analysts WHERE id=?", (analyst_id,))


def get_analyst_by_name(name: str) -> dict | None:
    return _one("SELECT * FROM analysts WHERE name=?", (name,))


# ── Tickets ────────────────────────────────────────────────────────────────────

def get_tickets(status: str | None = None, division: str | None = None,
                assignee_id: int | None = None, requester: str | None = None,
                include_history: bool = False) -> list[dict]:
    where, params = [], []
    if not include_history:
        where.append("t.is_history=0")
    if status:
        where.append("t.status=?"); params.append(status)
    if division:
        where.append("t.division=?"); params.append(division)
    if assignee_id is not None:
        where.append("t.assignee_id=?"); params.append(assignee_id)
    if requester:
        where.append("t.requester=?"); params.append(requester)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    return _rows(f"""
        SELECT t.*, a.name AS assignee_name,
               (SELECT COUNT(*) FROM deliverables d WHERE d.ticket_id=t.id) AS deliverable_count
        FROM tickets t LEFT JOIN analysts a ON a.id=t.assignee_id
        {clause} ORDER BY t.deadline, t.id
    """, tuple(params))


def get_ticket(ticket_id: int) -> dict | None:
    return _one("""
        SELECT t.*, a.name AS assignee_name FROM tickets t
        LEFT JOIN analysts a ON a.id=t.assignee_id WHERE t.id=?
    """, (ticket_id,))


def create_ticket(requester: str, division: str, title: str, description: str | None,
                  category: str | None, priority: str, deadline: str,
                  pred: dict, confidence: str) -> int:
    return _exec("""
        INSERT INTO tickets (requester,division,title,description,category,priority,deadline,
                             pred_low,pred_likely,pred_high,pred_method,confidence,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (requester, division, title, description, category, priority, deadline,
          pred["low"], pred["likely"], pred["high"], pred.get("method"), confidence, _now()))


def set_status(ticket_id: int, status: str) -> None:
    _exec("UPDATE tickets SET status=? WHERE id=?", (status, ticket_id))


def set_priority(ticket_id: int, priority: str) -> None:
    _exec("UPDATE tickets SET priority=? WHERE id=?", (priority, ticket_id))


def set_assignee(ticket_id: int, analyst_id: int | None) -> None:
    status = "Assigned" if analyst_id else "Unassigned"
    _exec("UPDATE tickets SET assignee_id=?, status=? WHERE id=?", (analyst_id, status, ticket_id))


def close_ticket(ticket_id: int, actual_hours: float | None) -> None:
    _exec("UPDATE tickets SET status='Closed', closed_at=?, actual_hours=COALESCE(?, actual_hours) WHERE id=?",
          (_now(), actual_hours, ticket_id))


def reopen_ticket(ticket_id: int) -> None:
    _exec("UPDATE tickets SET status='In progress', closed_at=NULL WHERE id=?", (ticket_id,))


def closed_ticket_history() -> list[dict]:
    """Every closed ticket with an assignee (seeded history + live): used for skill and track record."""
    return _rows("""
        SELECT id, assignee_id, category, requester, division, pred_likely, actual_hours,
               created_at, closed_at, deadline
        FROM tickets WHERE status='Closed' AND assignee_id IS NOT NULL
    """)


def handover_counts() -> dict[int, int]:
    rows = _rows("SELECT ticket_id, SUM(is_handover) AS n FROM assignments GROUP BY ticket_id HAVING n > 0")
    return {r["ticket_id"]: int(r["n"]) for r in rows}


def revision_counts() -> dict[tuple[int, str], tuple[int, int]]:
    rows = _rows("""
        SELECT d.uploaded_by AS analyst_id, t.category,
               SUM(CASE WHEN d.requester_rating IS NOT NULL THEN 1 ELSE 0 END) AS rated,
               SUM(CASE WHEN d.requester_rating='Needs revision' THEN 1 ELSE 0 END) AS revised
        FROM deliverables d JOIN tickets t ON t.id=d.ticket_id
        WHERE d.uploaded_by IS NOT NULL GROUP BY d.uploaded_by, t.category
    """)
    return {(r["analyst_id"], r["category"]): (int(r["rated"] or 0), int(r["revised"] or 0)) for r in rows}


_COUNTS = """
    COUNT(*) AS total,
    SUM(CASE WHEN status='Closed' THEN 1 ELSE 0 END) AS solved,
    SUM(CASE WHEN status='In progress' THEN 1 ELSE 0 END) AS in_progress,
    SUM(CASE WHEN assignee_id IS NULL AND status<>'Closed' THEN 1 ELSE 0 END) AS unassigned,
    SUM(CASE WHEN status='Waiting' THEN 1 ELSE 0 END) AS waiting,
    ROUND(SUM(CASE WHEN status<>'Closed' THEN COALESCE(pred_likely,0) ELSE 0 END), 1) AS hours_in_queue,
    SUM(CASE WHEN (status='Closed' AND substr(closed_at,1,10) > deadline)
              OR (status<>'Closed' AND deadline < date('now','localtime')) THEN 1 ELSE 0 END) AS missed
"""


def department_summary(division: str | None = None) -> list[dict]:
    q = f"SELECT division, {_COUNTS} FROM tickets WHERE is_history=0"
    params: tuple = ()
    if division:
        q += " AND division=?"
        params = (division,)
    rows = {r["division"]: r for r in _rows(q + " GROUP BY division", params)}
    from fairqueue.config import DEPARTMENTS
    empty = {"total": 0, "solved": 0, "in_progress": 0, "unassigned": 0, "waiting": 0,
             "hours_in_queue": 0, "missed": 0}
    return [rows.get(d, {"division": d, **empty}) for d in DEPARTMENTS if not division or d == division]


def team_summary(division: str | None = None) -> dict:
    q = f"SELECT {_COUNTS} FROM tickets WHERE is_history=0"
    row = _one(q + (" AND division=?" if division else ""), (division,) if division else ())
    return {k: (v or 0) for k, v in (row or {}).items()}


# ── Assignments and overrides ──────────────────────────────────────────────────

def create_assignment(ticket_id: int, recommended_id: int | None, recommended_fit: float | None,
                      chosen_id: int, chosen_fit: float | None, accepted: bool,
                      override_reason: str | None, decided_by: str | None,
                      support_id: int | None = None, is_handover: bool = False) -> int:
    return _exec("""
        INSERT INTO assignments (ticket_id,recommended_id,recommended_fit,chosen_id,chosen_fit,
                                 support_id,accepted,override_reason,decided_by,is_handover,decided_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, (ticket_id, recommended_id, recommended_fit, chosen_id, chosen_fit, support_id,
          int(accepted), override_reason, decided_by, int(is_handover), _now()))


def assignment_log() -> list[dict]:
    return _rows("""
        SELECT a.*, t.title, t.division, c.name AS chosen_name, r.name AS recommended_name,
               s.name AS support_name
        FROM assignments a JOIN tickets t ON t.id=a.ticket_id
        LEFT JOIN analysts c ON c.id=a.chosen_id
        LEFT JOIN analysts r ON r.id=a.recommended_id
        LEFT JOIN analysts s ON s.id=a.support_id
        WHERE t.is_history=0 ORDER BY a.decided_at DESC, a.id DESC
    """)


def override_rate() -> float:
    row = _one("""SELECT AVG(CASE WHEN accepted=0 THEN 1.0 ELSE 0.0 END) AS rate
                  FROM assignments a JOIN tickets t ON t.id=a.ticket_id
                  WHERE t.is_history=0 AND a.recommended_id IS NOT NULL""")
    return round(float(row["rate"] or 0), 2) if row else 0.0


def log_priority_change(ticket_id: int, suggested: str | None, chosen: str,
                        reason: str | None, changed_by: str | None) -> None:
    _exec("INSERT INTO priority_changes (ticket_id,suggested,chosen,reason,changed_by,changed_at) VALUES (?,?,?,?,?,?)",
          (ticket_id, suggested, chosen, reason, changed_by, _now()))


def priority_log() -> list[dict]:
    return _rows("""SELECT p.*, t.title, t.division FROM priority_changes p
                    JOIN tickets t ON t.id=p.ticket_id ORDER BY p.changed_at DESC, p.id DESC""")


# ── Leave ──────────────────────────────────────────────────────────────────────

def create_leave(analyst_id: int, start_date: str, end_date: str, reason: str | None) -> int:
    return _exec("INSERT INTO leave (analyst_id,start_date,end_date,reason,created_at) VALUES (?,?,?,?,?)",
                 (analyst_id, start_date, end_date, reason, _now()))


def get_leave(analyst_id: int | None = None, status: str | None = None) -> list[dict]:
    where, params = [], []
    if analyst_id is not None:
        where.append("l.analyst_id=?"); params.append(analyst_id)
    if status:
        where.append("l.status=?"); params.append(status)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    return _rows(f"""SELECT l.*, a.name AS analyst_name FROM leave l
                     JOIN analysts a ON l.analyst_id=a.id {clause} ORDER BY l.start_date""", tuple(params))


def get_leave_by_id(leave_id: int) -> dict | None:
    return _one("SELECT l.*, a.name AS analyst_name FROM leave l JOIN analysts a ON a.id=l.analyst_id WHERE l.id=?",
                (leave_id,))


def update_leave_status(leave_id: int, status: str) -> None:
    _exec("UPDATE leave SET status=? WHERE id=?", (status, leave_id))


# ── Feedback ───────────────────────────────────────────────────────────────────

def add_feedback(ticket_id: int, given_by: str | None, role: str, actual_hours: float | None,
                 estimate_rating: str | None, better_suited_id: int | None, comment: str | None) -> int:
    return _exec("""INSERT INTO feedback (ticket_id,given_by,role,actual_hours,estimate_rating,
                                          better_suited_id,comment,created_at)
                    VALUES (?,?,?,?,?,?,?,?)""",
                 (ticket_id, given_by, role, actual_hours, estimate_rating, better_suited_id, comment, _now()))


def get_feedback(ticket_id: int | None = None, given_by: str | None = None) -> list[dict]:
    where, params = [], []
    if ticket_id:
        where.append("f.ticket_id=?"); params.append(ticket_id)
    if given_by:
        where.append("f.given_by=?"); params.append(given_by)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    return _rows(f"""SELECT f.*, t.title, t.category, t.division, t.pred_likely, b.name AS better_suited_name
                     FROM feedback f JOIN tickets t ON t.id=f.ticket_id
                     LEFT JOIN analysts b ON b.id=f.better_suited_id
                     {clause} ORDER BY f.created_at DESC""", tuple(params))


def underestimated_types() -> list[dict]:
    """Ticket types whose actual hours run above the estimate, from closed tickets and feedback."""
    return _rows("""
        SELECT t.category,
               COUNT(*) AS n_closed,
               ROUND(AVG(t.actual_hours / t.pred_likely), 2) AS actual_over_estimate,
               (SELECT COUNT(*) FROM feedback f JOIN tickets t2 ON t2.id=f.ticket_id
                 WHERE t2.category=t.category AND f.estimate_rating='Too low') AS too_low_votes
        FROM tickets t
        WHERE t.status='Closed' AND t.actual_hours IS NOT NULL AND t.pred_likely > 0
        GROUP BY t.category HAVING n_closed >= 3
        ORDER BY actual_over_estimate DESC
    """)


# ── Deliverables ───────────────────────────────────────────────────────────────

def add_deliverable(ticket_id: int, uploaded_by: int | None, kind: str, title: str | None,
                    file_name: str | None, file_path: str | None, url: str | None,
                    file_type: str | None, summary: str | None) -> int:
    row = _one("SELECT MAX(version) AS v FROM deliverables WHERE ticket_id=?", (ticket_id,))
    version = (int(row["v"]) + 1) if row and row["v"] else 1
    return _exec("""INSERT INTO deliverables (ticket_id,uploaded_by,kind,title,file_name,file_path,url,
                                              file_type,summary,version,uploaded_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                 (ticket_id, uploaded_by, kind, title, file_name, file_path, url, file_type,
                  summary, version, _now()))


def get_deliverables(ticket_id: int | None = None, analyst_id: int | None = None,
                     requester: str | None = None, division: str | None = None,
                     category: str | None = None, q: str | None = None,
                     date_from: str | None = None, date_to: str | None = None) -> list[dict]:
    where, params = [], []
    for col, val in (("d.ticket_id", ticket_id), ("d.uploaded_by", analyst_id), ("t.requester", requester),
                     ("t.division", division), ("t.category", category)):
        if val is not None and val != "":
            where.append(f"{col}=?"); params.append(val)
    if q:
        where.append("(LOWER(d.title) LIKE ? OR LOWER(d.summary) LIKE ? OR LOWER(t.title) LIKE ?)")
        params += [f"%{q.lower()}%"] * 3
    if date_from:
        where.append("substr(d.uploaded_at,1,10) >= ?"); params.append(date_from)
    if date_to:
        where.append("substr(d.uploaded_at,1,10) <= ?"); params.append(date_to)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    return _rows(f"""
        SELECT d.*, t.title AS ticket_title, t.division, t.category, t.requester, t.status AS ticket_status,
               a.name AS analyst_name
        FROM deliverables d JOIN tickets t ON d.ticket_id=t.id
        LEFT JOIN analysts a ON d.uploaded_by=a.id
        {clause} ORDER BY d.uploaded_at DESC, d.version DESC
    """, tuple(params))


def get_deliverable(deliverable_id: int) -> dict | None:
    return _one("SELECT d.*, t.requester, t.assignee_id FROM deliverables d JOIN tickets t ON t.id=d.ticket_id WHERE d.id=?",
                (deliverable_id,))


def rate_deliverable(deliverable_id: int, rating: str, note: str | None) -> None:
    _exec("UPDATE deliverables SET requester_rating=?, revision_note=? WHERE id=?", (rating, note, deliverable_id))
    if rating == "Needs revision":
        row = _one("SELECT ticket_id FROM deliverables WHERE id=?", (deliverable_id,))
        if row:
            reopen_ticket(row["ticket_id"])


def revision_stats() -> list[dict]:
    return _rows("""
        SELECT t.category, COUNT(*) AS delivered,
               SUM(CASE WHEN d.requester_rating='Needs revision' THEN 1 ELSE 0 END) AS revisions
        FROM deliverables d JOIN tickets t ON t.id=d.ticket_id
        GROUP BY t.category ORDER BY revisions DESC, delivered DESC
    """)


# ── Pairings ───────────────────────────────────────────────────────────────────

def usual_partner(requester: str) -> int | None:
    row = _one("SELECT analyst_id FROM pairings WHERE requester=? AND is_default=1", (requester,))
    return row["analyst_id"] if row else None


def get_requesters() -> list[dict]:
    """People who submit tickets: the seeded requesters plus every analyst (analysts can request too)."""
    rows = _rows("SELECT DISTINCT p.requester AS name, p.division FROM pairings p ORDER BY p.division, p.requester")
    return rows + [{"name": a["name"], "division": None, "is_analyst": True} for a in get_analysts()]


# ── Fit settings ───────────────────────────────────────────────────────────────

DEFAULT_FIT = {"w_skill": 0.35, "w_track": 0.20, "w_pairing": 0.15, "w_capacity": 0.15,
               "w_deadline": 0.15, "good_fit": 70, "poor_fit": 50}


def get_fit_settings() -> dict:
    return _one("SELECT * FROM fit_settings WHERE id=1") or dict(DEFAULT_FIT)


def save_fit_settings(w: dict, updated_by: str | None) -> None:
    _exec("""
        INSERT INTO fit_settings (id,w_skill,w_track,w_pairing,w_capacity,w_deadline,good_fit,poor_fit,updated_by,updated_at)
        VALUES (1,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET w_skill=excluded.w_skill, w_track=excluded.w_track,
            w_pairing=excluded.w_pairing, w_capacity=excluded.w_capacity, w_deadline=excluded.w_deadline,
            good_fit=excluded.good_fit, poor_fit=excluded.poor_fit,
            updated_by=excluded.updated_by, updated_at=excluded.updated_at
    """, (w["w_skill"], w["w_track"], w["w_pairing"], w["w_capacity"], w["w_deadline"],
          w["good_fit"], w["poor_fit"], updated_by, _now()))


# ── Skill adjustments ──────────────────────────────────────────────────────────

def get_skill_deltas(analyst_id: int) -> dict[str, float]:
    rows = _rows("""SELECT category, SUM(adjustment) AS total FROM skill_adjustments
                    WHERE analyst_id=? AND approved=1 GROUP BY category""", (analyst_id,))
    return {r["category"]: float(r["total"]) for r in rows}


def add_skill_adjustment(analyst_id: int, category: str, adjustment: float, reason: str | None,
                         set_by: str, approved: bool) -> int:
    return _exec("""INSERT INTO skill_adjustments (analyst_id,category,adjustment,reason,set_by,approved,created_at)
                    VALUES (?,?,?,?,?,?,?)""",
                 (analyst_id, category, adjustment, reason, set_by, int(approved), _now()))


def list_skill_adjustments(analyst_id: int | None = None) -> list[dict]:
    q = """SELECT s.*, a.name AS analyst_name FROM skill_adjustments s
           JOIN analysts a ON a.id=s.analyst_id"""
    if analyst_id is not None:
        return _rows(q + " WHERE s.analyst_id=? ORDER BY s.created_at DESC", (analyst_id,))
    return _rows(q + " ORDER BY s.approved, s.created_at DESC")


def set_skill_adjustment_approval(adj_id: int, approved: bool) -> None:
    if approved:
        _exec("UPDATE skill_adjustments SET approved=1 WHERE id=?", (adj_id,))
    else:
        _exec("DELETE FROM skill_adjustments WHERE id=? AND approved=0", (adj_id,))


# ── LLM output cache ───────────────────────────────────────────────────────────

def get_cached_agent_output(ticket_id: int, agent: str) -> dict | None:
    row = _one("SELECT output FROM agent_cache WHERE ticket_id=? AND agent=? ORDER BY id DESC LIMIT 1",
               (ticket_id, agent))
    if row:
        try:
            return json.loads(row["output"])
        except ValueError:
            return None
    return None


def cache_agent_output(ticket_id: int | None, agent: str, output: dict, method: str = "llm") -> None:
    _exec("INSERT INTO agent_cache (ticket_id,agent,output,method,created_at) VALUES (?,?,?,?,?)",
          (ticket_id, agent, json.dumps(output, default=str), method, _now()))
