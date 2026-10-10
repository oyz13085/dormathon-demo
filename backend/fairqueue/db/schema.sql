-- FairQueue schema. seed.py drops and recreates everything for a clean demo state.
--
-- Status flow (every dashboard and count uses these):
--   Unassigned   submitted, no assignee yet (low-confidence tickets wait here for the lead)
--   Assigned     assignee confirmed
--   In progress  analyst started work
--   Waiting      paused for information from the requester (not counted as analyst effort)
--   Closed       solved: deliverable attached, or "No deliverable" with a reason
--   Needs revision on a deliverable reopens the ticket (back to In progress, new version)
-- "Unassigned" in counts = any ticket with no assignee that isn't Closed.

CREATE TABLE IF NOT EXISTS analysts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    skills       TEXT    NOT NULL DEFAULT '',   -- comma-separated categories
    weekly_hours REAL    NOT NULL DEFAULT 40,
    role_title   TEXT,
    active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester    TEXT    NOT NULL,
    division     TEXT    NOT NULL CHECK (division IN ('HR','IT','Finance','Marketing')),
    title        TEXT    NOT NULL,
    description  TEXT,
    category     TEXT,
    priority     TEXT    NOT NULL DEFAULT 'Medium'
                     CHECK (priority IN ('Low','Medium','High','Critical')),
    status       TEXT    NOT NULL DEFAULT 'Unassigned'
                     CHECK (status IN ('Unassigned','Assigned','In progress','Waiting','Closed')),
    assignee_id  INTEGER REFERENCES analysts(id),
    deadline     TEXT    NOT NULL,              -- ISO date
    pred_low     REAL,
    pred_likely  REAL,
    pred_high    REAL,
    pred_method  TEXT,                          -- model | rule-based
    confidence   TEXT    CHECK (confidence IN ('High','Low')),
    actual_hours REAL,
    is_history   INTEGER NOT NULL DEFAULT 0,    -- 1 = seeded past ticket (not in the live queue)
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id        INTEGER NOT NULL REFERENCES tickets(id),
    recommended_id   INTEGER REFERENCES analysts(id),
    recommended_fit  REAL,
    chosen_id        INTEGER REFERENCES analysts(id),
    chosen_fit       REAL,
    support_id       INTEGER REFERENCES analysts(id),
    accepted         INTEGER,          -- 1 accepted, 0 overridden
    override_reason  TEXT,
    decided_by       TEXT,
    is_handover      INTEGER NOT NULL DEFAULT 0,   -- 1 = moved from another analyst
    decided_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS priority_changes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
    suggested   TEXT,
    chosen      TEXT    NOT NULL,
    reason      TEXT,
    changed_by  TEXT,
    changed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    analyst_id  INTEGER NOT NULL REFERENCES analysts(id),
    start_date  TEXT    NOT NULL,
    end_date    TEXT    NOT NULL,
    reason      TEXT,
    status      TEXT    NOT NULL DEFAULT 'Requested'
                    CHECK (status IN ('Requested','Approved','Rejected')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id         INTEGER NOT NULL REFERENCES tickets(id),
    given_by          TEXT,
    role              TEXT    CHECK (role IN ('analyst','lead')),
    actual_hours      REAL,
    estimate_rating   TEXT    CHECK (estimate_rating IN ('Too low','About right','Too high')),
    better_suited_id  INTEGER REFERENCES analysts(id),
    comment           TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliverables (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id        INTEGER NOT NULL REFERENCES tickets(id),
    uploaded_by      INTEGER REFERENCES analysts(id),
    kind             TEXT    CHECK (kind IN ('File','Link','None')),
    title            TEXT,
    file_name        TEXT,
    file_path        TEXT,            -- e.g. uploads/ticket_42/q3_report.pdf
    url              TEXT,            -- dashboard, notebook or Drive link
    file_type        TEXT,            -- pdf, xlsx, csv, pptx, png
    summary          TEXT,            -- what was asked, found, next step (or why no deliverable)
    version          INTEGER NOT NULL DEFAULT 1,
    requester_rating TEXT    CHECK (requester_rating IN ('Useful','Needs revision')),
    revision_note    TEXT,
    uploaded_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pairings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    requester   TEXT    NOT NULL,
    division    TEXT,
    analyst_id  INTEGER NOT NULL REFERENCES analysts(id),
    is_default  INTEGER NOT NULL DEFAULT 1,
    UNIQUE (requester, analyst_id)
);

CREATE TABLE IF NOT EXISTS fit_settings (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    w_skill     REAL NOT NULL DEFAULT 0.35,
    w_track     REAL NOT NULL DEFAULT 0.20,
    w_pairing   REAL NOT NULL DEFAULT 0.15,
    w_capacity  REAL NOT NULL DEFAULT 0.15,
    w_deadline  REAL NOT NULL DEFAULT 0.15,
    good_fit    REAL NOT NULL DEFAULT 70,
    poor_fit    REAL NOT NULL DEFAULT 50,
    updated_by  TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_adjustments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    analyst_id  INTEGER NOT NULL REFERENCES analysts(id),
    category    TEXT    NOT NULL,
    adjustment  REAL    NOT NULL,      -- e.g. +0.2 or -0.1 on the 0-1 skill scale
    reason      TEXT,
    set_by      TEXT,                  -- lead, or the analyst for a self-flag
    approved    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Every LLM output (and its rule-based fallback) is stored so the demo never waits on the API
CREATE TABLE IF NOT EXISTS agent_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER REFERENCES tickets(id),
    agent       TEXT    NOT NULL,
    output      TEXT    NOT NULL,
    method      TEXT    NOT NULL DEFAULT 'llm',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
