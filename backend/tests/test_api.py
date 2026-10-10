"""
End-to-end API checks against a freshly seeded database.
Run from backend/:  python -m pytest tests -q   (or python tests/test_api.py)
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
_tmp = tempfile.mkdtemp()
os.environ["DB_PATH"] = os.path.join(_tmp, "test.db")
os.environ["UPLOADS_DIR"] = os.path.join(_tmp, "uploads")
os.environ.pop("ANTHROPIC_API_KEY", None)        # exercise the rule-based fallbacks

from fastapi.testclient import TestClient        # noqa: E402
from fairqueue.db.seed import seed               # noqa: E402
import main                                      # noqa: E402

seed()
client = TestClient(main.app)


def get(path, **params):
    r = client.get(path, params=params)
    assert r.status_code == 200, (path, r.status_code, r.text)
    return r.json()


def tickets_by_title(role="lead", user=None):
    return {t["title"]: t for t in get("/tickets/", role=role, user=user)}


def test_summary_counts_follow_the_plan():
    s = get("/tickets/summary")
    t = s["team"]
    assert t["total"] == sum(d["total"] for d in s["departments"])
    assert {d["division"] for d in s["departments"]} == {"HR", "IT", "Finance", "Marketing"}
    assert t["unassigned"] == 4 and t["at_risk"] >= 1
    assert get("/tickets/summary", division="Finance")["team"]["total"] < t["total"]


def test_unequal_workload_and_at_risk_payroll():
    w = {a["name"]: a for a in get("/assignment/workload")}
    assert w["Aiman"]["open_tickets"] == 5 and w["Mei Ling"]["open_tickets"] == 5
    assert w["Aiman"]["open_hours"] <= 7 and w["Mei Ling"]["open_hours"] >= 38
    alerts = get("/prediction/risk")["alerts"]
    payroll = next(a for a in alerts if a["ticket_title"] == "Month-end payroll variance report")
    assert payroll["cause"] == "Overloaded assignee" and len(payroll["facts"]) == 3


def test_low_confidence_goes_to_lead():
    t = tickets_by_title()["AI ethics compliance audit"]
    card = get(f"/assignment/recommend/{t['id']}")
    assert card["decision"] == "low_confidence" and card["recommended"] is None


def test_recommend_accept_and_override_needs_reason():
    t = tickets_by_title()["Q4 launch target list"]
    card = get(f"/assignment/recommend/{t['id']}")
    rec = card["recommended"]["analyst_id"]
    other = next(c["analyst_id"] for c in card["candidates"] if c["analyst_id"] != rec)
    r = client.post("/assignment/assign", json={"ticket_id": t["id"], "analyst_id": other})
    assert r.status_code == 400
    r = client.post("/assignment/assign", json={"ticket_id": t["id"], "analyst_id": other,
                                                "override_reason": "Sarah is presenting all week"})
    assert r.status_code == 200 and r.json()["accepted"] is False
    r = client.post("/assignment/assign", json={"ticket_id": t["id"], "analyst_id": rec,
                                                "override_reason": "back to Sarah"})
    assert r.json()["handover"] is True
    log = get("/assignment/log")
    assert log["handovers"] >= 1 and log["override_rate"] > 0


def test_leave_request_runs_whatif():
    ravi = next(a for a in get("/meta")["analysts"] if a["name"] == "Ravi")
    pending = get("/planning/leave", status="Requested")[0]
    assert pending["analyst_id"] == ravi["id"] and 2 <= len(pending["whatif"]["broken"]) <= 3
    assert all(b["takeover"] for b in pending["whatif"]["broken"])
    r = client.post("/planning/leave", json={"analyst_id": ravi["id"], "start_date": "2030-01-01",
                                             "end_date": "2030-01-03"})
    assert r.status_code == 201 and "whatif" in r.json()


def test_requester_sees_no_predictions():
    mine = get("/tickets/", role="requester", user="Nurul Huda")
    assert mine and all(t["requester"] == "Nurul Huda" for t in mine)
    assert all("pred_likely" not in t and "p_miss" not in t for t in mine)
    assert client.get("/assignment/workload", params={"role": "requester"}).status_code == 403
    assert client.get("/planning/leave", params={"role": "requester"}).status_code == 403


def test_suggest_and_submit():
    body = {"title": "Monthly payroll variance report", "division": "Finance", "deadline": "2030-01-02",
            "requester": "Nurul Huda", "description": "Variance by cost centre for month-end"}
    s = client.post("/tickets/suggest", json=body).json()
    assert s["priority_method"] == "rule-based" and s["priority"] in ("Low", "Medium", "High")
    assert s["category"] == "Reporting" and s["hours"]["low"] <= s["hours"]["likely"] <= s["hours"]["high"]
    r = client.post("/tickets/", json={**body, "priority": "High", "category": s["category"],
                                       "suggested_priority": s["priority"]})
    assert r.status_code == 201
    assert any(p["ticket_id"] == r.json()["id"] for p in get("/assignment/log")["priority_changes"])


def test_close_needs_deliverable_then_requester_rates():
    t = tickets_by_title()["Server monitoring dashboard"]
    form = {"analyst_id": str(t["assignee_id"]), "actual_hours": "4", "kind": "File", "summary": "x"}
    assert client.post(f"/tickets/{t['id']}/close", data=form).status_code == 400
    r = client.post(f"/tickets/{t['id']}/close", data=form,
                    files={"file": ("monitoring.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert r.status_code == 200 and r.json()["status"] == "Closed"
    d = get("/deliverables/", role="requester", user="Kevin Lim")
    mine = next(x for x in d if x["ticket_id"] == t["id"])
    assert client.get(f"/deliverables/{mine['id']}/open").status_code == 200
    r = client.patch(f"/deliverables/{mine['id']}/rate", json={"rating": "Needs revision", "by": "Kevin Lim"})
    assert r.status_code == 400                    # needs a note
    r = client.patch(f"/deliverables/{mine['id']}/rate",
                     json={"rating": "Needs revision", "note": "Add disk usage", "by": "Kevin Lim"})
    assert r.status_code == 200
    assert get(f"/tickets/{t['id']}")["status"] == "In progress"


def test_forecast_replay_and_library():
    f = get("/planning/forecast")
    assert len(f["weeks"]) == 2 and f["weeks"][0]["message"]
    rp = get("/prediction/replay")
    assert set(rp["policies"]) >= {"actual", "round_robin", "fewest_open", "fairqueue"}
    assert rp["data_source"] in ("synthetic", "mendeley")
    lib = get("/deliverables/", q="sales")
    assert any("Sales" in (d["title"] or "") for d in lib)
    assert get("/deliverables/similar", title="Q3 sales performance")


def test_settings_and_skill_flags():
    bad = client.put("/assignment/settings", json={"w_skill": 0.9})
    assert bad.status_code == 400
    flags = [s for s in get("/assignment/skills") if not s["approved"]]
    assert flags
    assert client.patch(f"/assignment/skills/{flags[0]['id']}", json={"approved": True}).status_code == 200


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
