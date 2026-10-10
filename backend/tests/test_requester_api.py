"""
Requester API: completed-work history, reviews and revision requests.
Every test runs against its own freshly seeded database and uploads folder.
Run from backend/:  python tests/test_requester_api.py   (or python -m pytest tests -q)
"""
import os
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "import.db"))
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient        # noqa: E402
from fairqueue import config                     # noqa: E402
from fairqueue.db import repo                    # noqa: E402
from fairqueue.db.seed import seed               # noqa: E402
import main                                      # noqa: E402

client = TestClient(main.app)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
CSV = b"region,churn\nNorth,0.31\n"


@contextmanager
def fresh_db():
    """A newly seeded database and empty uploads folder for one test, restored afterwards."""
    tmp = Path(tempfile.mkdtemp())
    old_db, old_uploads = repo.DB_PATH, config.UPLOADS_DIR
    repo.DB_PATH, config.UPLOADS_DIR = str(tmp / "test.db"), tmp / "uploads"
    try:
        seed(repo.DB_PATH)
        yield tmp
    finally:
        repo.DB_PATH, config.UPLOADS_DIR = old_db, old_uploads


def completed(requester):
    r = client.get("/requester/completed-work", params={"requester": requester})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def item(requester, title):
    return next(i for i in completed(requester) if i["title"] == title)


def revise(deliverable_id, requester, files=(), **fields):
    data = {"requester": requester, "reason": "fix_issue", "problem": "North total is wrong.",
            "requested_changes": "Recalculate North from the CSV.", **fields}
    return client.post(f"/requester/deliverables/{deliverable_id}/revision-requests", data=data,
                       files=[("files", f) for f in files])


def ticket(ticket_id):
    return repo.get_ticket(ticket_id)


# ── Completed work ─────────────────────────────────────────────────────────────

def test_completed_work_includes_seeded_reviews_as_legacy_history():
    with fresh_db():
        q3 = item("Daniel Tan", "Q3 sales report")
        v = q3["versions"][0]
        assert q3["status"] == "Closed" and v["review_status"] == "Useful"
        assert q3["assignee_name"] == repo.get_ticket(q3["ticket_id"])["assignee_name"]
        assert v["file_url"] == f"/deliverables/{v['id']}/open"
        # The seeded rating is imported once, honestly marked: no reviewer, no time
        assert [(r["rating"], r["source"], r["created_at"]) for r in v["reviews"]] == [("Useful", "legacy", None)]
        assert len(item("Daniel Tan", "Q3 sales report")["versions"][0]["reviews"]) == 1   # not imported twice
        assert completed("Nurul Huda") == []                                                  # only your own work


# ── Reviews ────────────────────────────────────────────────────────────────────

def test_useful_is_saved_once_and_keeps_the_ticket_closed():
    with fresh_db():
        churn = item("Aisha Zainal", "Customer churn analysis")
        d = churn["versions"][0]
        assert d["review_status"] == "Awaiting review" and d["reviews"] == []
        r = client.post(f"/requester/deliverables/{d['id']}/reviews", json={"requester": "Aisha Zainal", "rating": "Useful"})
        assert r.status_code == 201, r.text
        again = client.post(f"/requester/deliverables/{d['id']}/reviews", json={"requester": "Aisha Zainal", "rating": "Useful"})
        assert again.status_code == 409
        after = item("Aisha Zainal", "Customer churn analysis")
        assert after["status"] == "Closed"
        assert [x["rating"] for x in after["versions"][0]["reviews"]] == ["Useful"]


def test_review_rules():
    with fresh_db():
        d = item("Aisha Zainal", "Customer churn analysis")["versions"][0]
        url = f"/requester/deliverables/{d['id']}/reviews"
        assert client.post(url, json={"requester": "Daniel Tan", "rating": "Useful"}).status_code == 403
        assert client.post(url, json={"requester": "Aisha Zainal", "rating": "Needs revision", "note": "  "}).status_code == 400
        assert client.post("/requester/deliverables/99999/reviews", json={"requester": "x", "rating": "Useful"}).status_code == 404
        r = client.post(url, json={"requester": "Aisha Zainal", "rating": "Needs revision", "note": "Split by region."})
        assert r.status_code == 201 and ticket(d["ticket_id"])["status"] == "In progress"
        # Reopened: nothing more can be reviewed until the analyst delivers the next version
        assert client.post(url, json={"requester": "Aisha Zainal", "rating": "Useful"}).status_code == 409


# ── Revision after Useful ──────────────────────────────────────────────────────

def test_revision_after_useful_keeps_the_useful_review_and_reopens():
    with fresh_db() as tmp:
        q3 = item("Daniel Tan", "Q3 sales report")
        d = q3["versions"][0]
        r = revise(d["id"], "Daniel Tan", files=[("annotated.png", PNG, "image/png"), ("figures.csv", CSV, "text/csv")],
                   location="Slide 3")
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["ticket"] == {"id": q3["ticket_id"], "status": "In progress"}
        req = body["revision_request"]
        assert req["reason"] == "fix_issue" and req["location"] == "Slide 3"
        assert [(a["file_name"], a["size_bytes"]) for a in req["attachments"]] == [("annotated.png", len(PNG)), ("figures.csv", len(CSV))]

        v = item("Daniel Tan", "Q3 sales report")["versions"][0]
        assert [x["rating"] for x in v["reviews"]] == ["Useful", "Needs revision"]        # history kept
        assert v["review_status"] == "Needs revision" and "Recalculate North" in v["revision_note"]
        assert v["revision_requests"][0]["id"] == req["id"]
        # Files live with the request, apart from the analyst's deliverables
        stored = sorted(p.name for p in (tmp / "uploads" / "revisions").rglob("*") if p.is_file())
        assert stored == ["annotated.png", "figures.csv"]
        assert not list((tmp / "uploads").glob(f"ticket_{q3['ticket_id']}/annotated.png"))
        # The deliverable is still listed everywhere it was
        assert any(x["id"] == d["id"] for x in client.get("/deliverables/", params={"role": "lead"}).json())


def test_revision_without_attachments():
    with fresh_db():
        d = item("Daniel Tan", "Q3 sales report")["versions"][0]
        r = revise(d["id"], "Daniel Tan")
        assert r.status_code == 201, r.text
        assert r.json()["revision_request"]["attachments"] == []


def test_assigned_analyst_can_read_the_request_and_files_others_cannot():
    with fresh_db():
        q3 = item("Daniel Tan", "Q3 sales report")
        analyst = ticket(q3["ticket_id"])["assignee_name"]
        att = revise(q3["versions"][0]["id"], "Daniel Tan", files=[("annotated.png", PNG, "image/png")]).json()["revision_request"]["attachments"][0]

        reqs = client.get(f"/requester/tickets/{q3['ticket_id']}/revision-requests", params={"user": analyst})
        assert reqs.status_code == 200 and reqs.json()[0]["problem"] == "North total is wrong."
        f = client.get(f"/requester/revision-attachments/{att['id']}", params={"user": analyst})
        assert f.status_code == 200 and f.content == PNG
        assert client.get(f"/requester/revision-attachments/{att['id']}", params={"user": "Aisha Zainal"}).status_code == 403
        assert client.get(f"/requester/tickets/{q3['ticket_id']}/revision-requests", params={"user": "Aisha Zainal"}).status_code == 403
        # The analyst's existing views read the deliverable's current note
        mine = client.get("/deliverables/", params={"role": "analyst", "user": analyst}).json()
        assert any(x["ticket_id"] == q3["ticket_id"] and x["requester_rating"] == "Needs revision" for x in mine)


def test_resubmission_is_a_new_version_awaiting_review():
    with fresh_db():
        q3 = item("Daniel Tan", "Q3 sales report")
        v1 = q3["versions"][0]
        assert revise(v1["id"], "Daniel Tan").status_code == 201
        t = ticket(q3["ticket_id"])
        closed = client.post(f"/tickets/{t['id']}/close", data={
            "analyst_id": t["assignee_id"], "actual_hours": 2, "kind": "Link",
            "url": "https://example.com/q3-v2", "summary": "Recalculated North from the CSV."})
        assert closed.status_code == 200, closed.text

        versions = item("Daniel Tan", "Q3 sales report")["versions"]
        assert [v["version"] for v in versions] == [2, 1]
        v2 = versions[0]
        assert v2["review_status"] == "Awaiting review" and v2["reviews"] == []          # nothing carried over
        assert [x["rating"] for x in versions[1]["reviews"]] == ["Useful", "Needs revision"]
        # Only the newest version can be reviewed now
        old = client.post(f"/requester/deliverables/{v1['id']}/reviews", json={"requester": "Daniel Tan", "rating": "Useful"})
        assert old.status_code == 409
        new = client.post(f"/requester/deliverables/{v2['id']}/reviews", json={"requester": "Daniel Tan", "rating": "Useful"})
        assert new.status_code == 201
        assert item("Daniel Tan", "Q3 sales report")["status"] == "Closed"


def test_revision_stays_on_the_same_ticket_from_useful_to_version_2():
    """The full revision path on #322: no new ticket at any step, same analyst, both versions in history."""
    with fresh_db():
        churn = item("Aisha Zainal", "Customer churn analysis")
        v1 = churn["versions"][0]
        assert churn["ticket_id"] == 322 and churn["status"] == "Closed" and v1["version"] == 1
        analyst = ticket(322)["assignee_id"]
        tickets_before = len(repo.get_tickets())
        assert client.post(f"/requester/deliverables/{v1['id']}/reviews",
                           json={"requester": "Aisha Zainal", "rating": "Useful"}).status_code == 201

        r = revise(v1["id"], "Aisha Zainal", reason="clarify_improve", location="Sheet 'Drivers', chart 2",
                   files=[("annotated.png", PNG, "image/png")])
        assert r.status_code == 201, r.text
        assert r.json()["ticket"] == {"id": 322, "status": "In progress"}                  # reopened, not copied
        t = ticket(322)
        assert t["status"] == "In progress" and t["assignee_id"] == analyst                # same analyst
        assert len(repo.get_tickets()) == tickets_before                                   # no new ticket

        # The assigned analyst sees every field and can open the attachment
        req = client.get("/requester/tickets/322/revision-requests", params={"user": t["assignee_name"]}).json()[0]
        assert (req["reason"], req["location"]) == ("clarify_improve", "Sheet 'Drivers', chart 2")
        assert req["problem"] == "North total is wrong." and req["requested_changes"] == "Recalculate North from the CSV."
        att = client.get(f"/requester/revision-attachments/{req['attachments'][0]['id']}", params={"user": t["assignee_name"]})
        assert att.status_code == 200 and att.content == PNG

        # The corrected delivery is version 2 of #322
        closed = client.post("/tickets/322/close", data={"analyst_id": analyst, "actual_hours": 3, "kind": "Link",
                                                          "url": "https://example.com/churn-v2", "summary": "Clarified chart 2."})
        assert closed.status_code == 200, closed.text
        assert len(repo.get_tickets()) == tickets_before

        churn = item("Aisha Zainal", "Customer churn analysis")
        assert churn["ticket_id"] == 322 and churn["status"] == "Closed"
        v2, old = churn["versions"]
        assert (v2["version"], v2["ticket_id"], v2["review_status"], v2["reviews"]) == (2, 322, "Awaiting review", [])
        assert (old["id"], old["ticket_id"]) == (v1["id"], 322)                              # version 1 kept as it was
        assert [x["rating"] for x in old["reviews"]] == ["Useful", "Needs revision"]
        assert old["revision_requests"][0]["id"] == req["id"]


def test_lead_reassignment_after_a_revision_hands_the_instructions_over():
    with fresh_db():
        v1 = item("Aisha Zainal", "Customer churn analysis")["versions"][0]
        assert revise(v1["id"], "Aisha Zainal").status_code == 201
        before = ticket(322)
        other = next(a for a in client.get("/meta").json()["analysts"] if a["id"] != before["assignee_id"])
        r = client.post("/assignment/assign", json={"ticket_id": 322, "analyst_id": other["id"],
                                                    "override_reason": "Sarah is on leave"})
        assert r.status_code == 200, r.text
        assert ticket(322)["assignee_id"] == other["id"] and ticket(322)["status"] == "In progress"
        # The revision request follows the ticket to whoever is assigned now
        reqs = client.get("/requester/tickets/322/revision-requests", params={"user": other["name"]})
        assert reqs.status_code == 200 and len(reqs.json()) == 1
        closed = client.post("/tickets/322/close", data={"analyst_id": other["id"], "actual_hours": 2, "kind": "None",
                                                          "summary": "Answered in the ticket thread."})
        assert closed.status_code == 200, closed.text
        assert [v["version"] for v in item("Aisha Zainal", "Customer churn analysis")["versions"]] == [2, 1]


# ── Validation and atomicity ───────────────────────────────────────────────────

def test_revision_request_validation():
    with fresh_db() as tmp:
        d = item("Daniel Tan", "Q3 sales report")["versions"][0]
        assert revise(d["id"], "Daniel Tan", problem="   ").status_code == 400
        assert revise(d["id"], "Daniel Tan", requested_changes="").status_code in (400, 422)
        assert revise(d["id"], "Daniel Tan", reason="whatever").status_code == 400
        assert revise(d["id"], "Aisha Zainal").status_code == 403
        assert revise(d["id"], "Daniel Tan", files=[("tool.exe", b"MZ", "application/octet-stream")]).status_code == 415
        assert revise(d["id"], "Daniel Tan", files=[("fake.png", b"not a png", "image/png")]).status_code == 415
        assert revise(d["id"], "Daniel Tan", files=[("big.pdf", b"%PDF" + b"0" * (10 * 1024 * 1024), "application/pdf")]).status_code == 413
        six = [(f"p{i}.png", PNG, "image/png") for i in range(6)]
        assert revise(d["id"], "Daniel Tan", files=six).status_code == 400
        # Nothing above changed anything: no history rows, no files, ticket still closed
        v = item("Daniel Tan", "Q3 sales report")
        assert v["status"] == "Closed" and [x["rating"] for x in v["versions"][0]["reviews"]] == ["Useful"]
        assert not list((tmp / "uploads").rglob("*.png"))


def test_rejected_after_files_were_read_leaves_no_files():
    with fresh_db() as tmp:
        d = item("Daniel Tan", "Q3 sales report")["versions"][0]
        assert revise(d["id"], "Daniel Tan").status_code == 201
        # Ticket is open now: valid files, but the request is refused inside the transaction
        r = revise(d["id"], "Daniel Tan", files=[("annotated.png", PNG, "image/png")])
        assert r.status_code == 409
        assert not list((tmp / "uploads").rglob("*.png"))


def test_reseed_resets_requester_history():
    with fresh_db():
        d = item("Daniel Tan", "Q3 sales report")["versions"][0]
        assert revise(d["id"], "Daniel Tan").status_code == 201
        seed(repo.DB_PATH)
        v = item("Daniel Tan", "Q3 sales report")
        assert v["status"] == "Closed"
        assert [(x["rating"], x["source"]) for x in v["versions"][0]["reviews"]] == [("Useful", "legacy")]
        assert v["versions"][0]["revision_requests"] == []


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
