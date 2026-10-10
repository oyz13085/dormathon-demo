-- Requester module tables. Created on first use (CREATE IF NOT EXISTS); dropped by the demo reseed.
-- deliverables.requester_rating / revision_note stay as the "current review" that other modules read;
-- these tables hold the full history and are never updated or deleted from.

CREATE TABLE IF NOT EXISTS deliverable_reviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    deliverable_id  INTEGER NOT NULL REFERENCES deliverables(id),
    rating          TEXT    NOT NULL CHECK (rating IN ('Useful','Needs revision')),
    note            TEXT,
    reviewed_by     TEXT,                 -- NULL for legacy imports, where nobody was recorded
    source          TEXT    NOT NULL DEFAULT 'requester' CHECK (source IN ('requester','legacy')),
    created_at      TEXT                  -- NULL for legacy imports, where the time is unknown
);
CREATE INDEX IF NOT EXISTS idx_reviews_deliverable ON deliverable_reviews(deliverable_id);

CREATE TABLE IF NOT EXISTS revision_requests (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id          INTEGER NOT NULL UNIQUE REFERENCES deliverable_reviews(id),
    deliverable_id     INTEGER NOT NULL REFERENCES deliverables(id),
    ticket_id          INTEGER NOT NULL REFERENCES tickets(id),
    reason             TEXT    NOT NULL CHECK (reason IN ('fix_issue','clarify_improve','additional_changes')),
    problem            TEXT    NOT NULL,
    location           TEXT,
    requested_changes  TEXT    NOT NULL,
    created_by         TEXT    NOT NULL,
    created_at         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revreq_ticket ON revision_requests(ticket_id);

-- Files the requester attaches to a revision request; kept apart from the analyst's deliverables
CREATE TABLE IF NOT EXISTS revision_attachments (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_request_id  INTEGER NOT NULL REFERENCES revision_requests(id),
    file_name            TEXT    NOT NULL,
    file_path            TEXT    NOT NULL,     -- uploads/revisions/<random folder>/<file_name>
    file_type            TEXT    NOT NULL,
    size_bytes           INTEGER NOT NULL,
    uploaded_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revatt_request ON revision_attachments(revision_request_id);
