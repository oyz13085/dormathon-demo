"""SQL for the leave advisor's own table. The leave request itself stays in the existing leave table."""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from fairqueue.db import repo

SCHEMA = Path(__file__).with_name("schema.sql")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(repo.DB_PATH, timeout=10)     # read at call time, so tests can point it elsewhere
    con.row_factory = sqlite3.Row
    return con


def ensure_schema() -> None:
    """Additive: creates leave_plans and leave_handovers if missing and touches nothing else."""
    con = _connect()
    try:
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if {"leave_plans", "leave_handovers"} <= have:
            return
        sql = "\n".join(line.split("--")[0] for line in SCHEMA.read_text(encoding="utf-8").splitlines())
        for stmt in sql.split(";"):
            if stmt.strip():
                con.execute(stmt)
        con.commit()
    finally:
        con.close()


def save_plan(leave_id: int, analyst_id: int, plan: dict, notes: dict, hours_left: dict) -> int:
    con = _connect()
    try:
        cur = con.execute("""INSERT INTO leave_plans (leave_id, analyst_id, plan_json, notes_json, hours_left_json, created_at)
                             VALUES (?, ?, ?, ?, ?, ?)""",
                          (leave_id, analyst_id, json.dumps(plan, default=str), json.dumps(notes),
                           json.dumps(hours_left), datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()


def get_plan(leave_id: int) -> dict | None:
    con = _connect()
    try:
        row = con.execute("SELECT * FROM leave_plans WHERE leave_id = ?", (leave_id,)).fetchone()
    finally:
        con.close()
    if not row:
        return None
    r = dict(row)
    return {"id": r["id"], "leave_id": r["leave_id"], "analyst_id": r["analyst_id"], "status": r["status"],
            "plan": json.loads(r["plan_json"]), "notes": json.loads(r["notes_json"]),
            "hours_left": json.loads(r["hours_left_json"]), "created_at": r["created_at"]}


def record_handover(ticket_id: int, from_id: int, to_id: int, start: str, end: str, by: str, by_ai: bool) -> int:
    ensure_schema()
    con = _connect()
    try:
        cur = con.execute("""INSERT INTO leave_handovers (ticket_id, from_analyst_id, to_analyst_id, leave_start, leave_end,
                                                          decided_by, decided_by_ai, created_at) VALUES (?,?,?,?,?,?,?,?)""",
                          (ticket_id, from_id, to_id, start, end, by, int(by_ai), datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        con.commit()
        return int(cur.lastrowid)
    finally:
        con.close()


def handovers_from(analyst_id: int, start: str, end: str) -> list[dict]:
    """Handovers this analyst made for these leave dates, with the ticket's current assignee and deadline."""
    ensure_schema()                         # also called outside the API (tests, live_check)
    con = _connect()
    try:
        rows = con.execute("""SELECT h.*, t.title, t.deadline, t.priority, t.status, t.assignee_id, a.name AS to_name,
                                     a.role_title AS to_role
                              FROM leave_handovers h JOIN tickets t ON t.id = h.ticket_id
                              JOIN analysts a ON a.id = h.to_analyst_id
                              WHERE h.from_analyst_id = ? AND h.leave_start = ? AND h.leave_end = ? ORDER BY h.id""",
                           (analyst_id, start, end)).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()
