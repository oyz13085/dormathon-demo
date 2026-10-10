-- Leave advisor tables. Created on first use (CREATE IF NOT EXISTS), so existing databases need no reseed;
-- the demo reseed drops it. Linked to the existing leave request; it never holds an approval or an assignment.

CREATE TABLE IF NOT EXISTS leave_plans (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    leave_id         INTEGER NOT NULL UNIQUE REFERENCES leave(id),
    analyst_id       INTEGER NOT NULL REFERENCES analysts(id),
    status           TEXT    NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed')),
    plan_json        TEXT    NOT NULL,              -- the impact analysis and proposed handovers at submission
    notes_json       TEXT    NOT NULL DEFAULT '{}', -- the analyst's handover notes per ticket
    hours_left_json  TEXT    NOT NULL DEFAULT '{}', -- hours left the analyst gave for In progress tickets
    created_at       TEXT    NOT NULL
);

-- Handovers an analyst made from the Request leave modal (through POST /leave-advisor/reassign).
-- The assignment itself is recorded by the existing assignment workflow (assignments table); this links it to the leave.
CREATE TABLE IF NOT EXISTS leave_handovers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id         INTEGER NOT NULL REFERENCES tickets(id),
    from_analyst_id   INTEGER NOT NULL REFERENCES analysts(id),
    to_analyst_id     INTEGER NOT NULL REFERENCES analysts(id),
    leave_start       TEXT    NOT NULL,
    leave_end         TEXT    NOT NULL,
    decided_by        TEXT    NOT NULL,
    decided_by_ai     INTEGER NOT NULL,              -- 1 = Groq's recommendation, 0 = rule-based fallback
    created_at        TEXT    NOT NULL
);
