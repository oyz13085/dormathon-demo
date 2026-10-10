"""
Seed the FairQueue demo database: the same story every time.

Run right before the demo:  python -m fairqueue.db.seed
(Drops and recreates every table. Dates are relative to today.)

Story
  Unequal workload   Aiman and Mei Ling hold 5 tickets each: about 6h vs 40h
  At-risk ticket     Finance month-end payroll variance report, Mei Ling overloaded
  Poor fit           Finance requester asks for an attrition model: usual partner Mei Ling scores low
  Low confidence     "AI ethics compliance audit", a type never seen before, routed to the lead
  Leave              Ravi has a leave request for the next 5 working days, which breaks 3 deadlines
  Deliverables       Q3 sales report (PDF), churn analysis (CSV), marketing dashboard (link),
                     a "No deliverable" answer, and one deliverable marked Needs revision
  History            ~300 closed past tickets (synthetic) so skill, track record and the
                     forecast have something to learn from
"""
from __future__ import annotations
import json
import os
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from fairqueue.config import UPLOADS_DIR

DB_PATH = os.getenv("DB_PATH", "fairqueue.db")
SCHEMA = Path(__file__).with_name("schema.sql")

ANALYSTS = [
    # id, name, declared skills, weekly hours, title
    (1, "Aiman",    "Automation,Dashboards,Reporting,Modelling,Documentation", 40, "Senior analyst, generalist"),
    (2, "Mei Ling", "Reporting,Automation",  40, "Finance reporting"),
    (3, "Ravi",     "Modelling,Documentation", 40, "HR data specialist"),
    (4, "Sarah",    "Dashboards,Modelling",  40, "Marketing analytics"),
    (5, "Jun Wei",  "Automation,Reporting",  40, "Junior analyst"),
]
REQUESTERS = [  # requester, division, usual partner
    ("Nurul Huda", "Finance", 2), ("Daniel Tan", "Finance", 2),
    ("Priya Nair", "HR", 3), ("Hafiz Rahman", "HR", 3),
    ("Kevin Lim", "IT", 1),
    ("Aisha Zainal", "Marketing", 4), ("Chloe Wong", "Marketing", 4),
]


def wd(n: int, base: date | None = None) -> date:
    """n working days from today (0 = today, or the next working day if today is a weekend)."""
    d = base or date.today()
    while d.weekday() >= 5:
        d += timedelta(days=1)
    step = 1 if n >= 0 else -1
    for _ in range(abs(n)):
        d += timedelta(days=step)
        while d.weekday() >= 5:
            d += timedelta(days=step)
    return d


def ts(d: date, hour: int = 10) -> str:
    return datetime.combine(d, datetime.min.time()).replace(hour=hour).strftime("%Y-%m-%d %H:%M:%S")


def seed(db_path: str | None = None) -> None:
    path = db_path or DB_PATH
    con = sqlite3.connect(path)
    cur = con.cursor()
    for t in ["agent_cache", "skill_adjustments", "fit_settings", "pairings", "deliverables",
              "feedback", "leave", "priority_changes", "assignments", "tickets", "analysts"]:
        cur.execute(f"DROP TABLE IF EXISTS {t}")
    cur.executescript(SCHEMA.read_text(encoding="utf-8"))

    cur.executemany("INSERT INTO analysts (id,name,skills,weekly_hours,role_title) VALUES (?,?,?,?,?)", ANALYSTS)
    cur.execute("INSERT INTO fit_settings (id,updated_by) VALUES (1,'system')")
    cur.executemany("INSERT INTO pairings (requester,division,analyst_id,is_default) VALUES (?,?,?,1)", REQUESTERS)

    _seed_history(cur)

    # ── Live tickets ───────────────────────────────────────────────────────────
    ids: dict[str, int] = {}

    def ticket(key, title, division, requester, category, priority, status, assignee,
               deadline: date, low, likely, high, created_days_ago=2, description=None,
               confidence="High", actual=None, closed: date | None = None):
        cur.execute("""
            INSERT INTO tickets (title,division,requester,category,priority,status,assignee_id,deadline,
                                 pred_low,pred_likely,pred_high,pred_method,confidence,actual_hours,
                                 created_at,closed_at,description)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,'model',?,?,?,?,?)
        """, (title, division, requester, category, priority, status, assignee, deadline.isoformat(),
              low, likely, high, confidence, actual, ts(wd(-created_days_ago)),
              ts(closed, 16) if closed else None, description))
        ids[key] = cur.lastrowid
        if assignee:
            cur.execute("""INSERT INTO assignments (ticket_id,recommended_id,chosen_id,accepted,decided_by,decided_at)
                           VALUES (?,?,?,1,'lead',?)""", (cur.lastrowid, assignee, assignee, ts(wd(-created_days_ago), 11)))
        return cur.lastrowid

    # Mei Ling: 5 tickets, about 40h. The month-end payroll report is set up to miss.
    ticket("ml1", "Supplier invoice reconciliation", "Finance", "Daniel Tan", "Reporting", "High",
           "In progress", 2, wd(1), 7, 10, 15)
    ticket("payroll", "Month-end payroll variance report", "Finance", "Nurul Huda", "Reporting", "Critical",
           "In progress", 2, wd(2), 12, 16, 24,
           description="Payroll variance by cost centre for the month-end close. CFO review on the deadline day.")
    ticket("ml3", "Budget vs actuals, Q3", "Finance", "Nurul Huda", "Reporting", "High",
           "Assigned", 2, wd(5), 5, 7, 11)
    ticket("ml4", "Year-end accruals summary", "Finance", "Daniel Tan", "Reporting", "Medium",
           "Assigned", 2, wd(8), 3, 4, 7)
    ticket("ml5", "Expense claim export fix", "Finance", "Daniel Tan", "Automation", "Low",
           "Assigned", 2, wd(10), 2, 3, 5)

    # Aiman: 5 tickets, about 6h
    for i, (title, d) in enumerate([("VPN access usage summary", 4), ("Licence count check", 6),
                                    ("Service desk SLA extract", 7), ("Laptop refresh list", 9),
                                    ("Shared drive permissions report", 11)]):
        ticket(f"ai{i}", title, "IT", "Kevin Lim", "Reporting" if i % 2 else "Automation", "Low",
               "In progress" if i == 0 else "Assigned", 1, wd(d), 0.8, 1.2, 2.0)

    # Ravi: about 31h, three deadlines fall inside his requested leave
    ticket("rv1", "Q3 headcount forecast", "HR", "Priya Nair", "Modelling", "High",
           "In progress", 3, wd(2), 7, 10, 15)
    ticket("rv2", "Appraisal calibration data pack", "HR", "Hafiz Rahman", "Reporting", "High",
           "Assigned", 3, wd(3), 6, 8, 12)
    ticket("rv3", "Payroll headcount reconciliation", "HR", "Hafiz Rahman", "Reporting", "Medium",
           "Assigned", 3, wd(5), 4, 6, 9)
    ticket("rv4", "Leave policy FAQ update", "HR", "Priya Nair", "Documentation", "Low",
           "Assigned", 3, wd(10), 3, 4, 6)

    # Sarah: about 15h, one ticket waiting on the requester
    ticket("sa1", "Campaign ROI dashboard", "Marketing", "Aisha Zainal", "Dashboards", "Medium",
           "In progress", 4, wd(6), 4, 6, 9)
    ticket("sa2", "Customer segmentation refresh", "Marketing", "Chloe Wong", "Modelling", "Medium",
           "Waiting", 4, wd(9), 5, 8, 12, description="Waiting for the CRM export from Marketing ops.")

    # Jun Wei: about 8h
    ticket("jw1", "Server monitoring dashboard", "IT", "Kevin Lim", "Dashboards", "Low",
           "Assigned", 5, wd(8), 3, 5, 8)
    ticket("jw2", "Ticket backlog extract script", "IT", "Kevin Lim", "Automation", "Low",
           "In progress", 5, wd(6), 2, 3, 5)

    # Unassigned
    ticket("attrition", "Attrition risk model for the finance team", "Finance", "Nurul Huda", "Modelling", "High",
           "Unassigned", None, wd(9), 8, 12, 19, created_days_ago=0,
           description="Which finance staff are at risk of leaving in the next 6 months? For the people review.")
    ticket("lowconf", "AI ethics compliance audit", "IT", "Kevin Lim", "AI compliance audit", "Medium",
           "Unassigned", None, wd(12), 4, 10, 25, created_days_ago=0, confidence="Low",
           description="First audit of how our models use personal data. Nothing like this has come in before.")
    ticket("mk_un", "Q4 launch target list", "Marketing", "Chloe Wong", "Dashboards", "High",
           "Unassigned", None, wd(4), 3, 5, 8, created_days_ago=1,
           description="Target list and tracking dashboard before the Q4 campaign launch.")
    ticket("hr_un", "Engagement survey dashboard", "HR", "Priya Nair", "Dashboards", "Low",
           "Unassigned", None, wd(14), 3, 5, 8, created_days_ago=1)

    # Closed, with deliverables
    ticket("q3", "Q3 sales report", "Finance", "Daniel Tan", "Reporting", "High", "Closed", 2,
           wd(-2), 5, 7, 11, created_days_ago=8, actual=7.5, closed=wd(-3))
    ticket("churn", "Customer churn analysis", "Marketing", "Aisha Zainal", "Modelling", "Medium", "Closed", 4,
           wd(-1), 7, 10, 15, created_days_ago=9, actual=11.0, closed=wd(-1))
    ticket("mdash", "Marketing performance dashboard", "Marketing", "Chloe Wong", "Dashboards", "Medium", "Closed", 4,
           wd(-4), 4, 6, 9, created_days_ago=10, actual=5.5, closed=wd(-5))
    ticket("vpnq", "Remote access usage question", "IT", "Kevin Lim", "Reporting", "Low", "Closed", 1,
           wd(-3), 0.5, 1, 2, created_days_ago=6, actual=0.5, closed=wd(-4))
    # Reopened after "Needs revision": back to In progress, counts in Ravi's queue
    ticket("survey", "Employee engagement survey analysis", "HR", "Priya Nair", "Reporting", "Medium", "In progress", 3,
           wd(11), 2, 3, 5, created_days_ago=10, actual=None,
           description="Revision requested: split results by department and tenure band.")

    _seed_deliverables(cur, ids)

    # ── Leave ──────────────────────────────────────────────────────────────────
    cur.executemany("INSERT INTO leave (analyst_id,start_date,end_date,reason,status,created_at) VALUES (?,?,?,?,?,?)", [
        (3, wd(1).isoformat(), wd(5).isoformat(), "Annual leave", "Requested", ts(wd(-1))),
        (2, wd(15).isoformat(), wd(17).isoformat(), "Annual leave", "Approved", ts(wd(-6))),
        (4, wd(20).isoformat(), wd(20).isoformat(), "Medical appointment", "Approved", ts(wd(-3))),
    ])

    # ── Feedback and skill adjustments ─────────────────────────────────────────
    cur.executemany("""INSERT INTO feedback (ticket_id,given_by,role,actual_hours,estimate_rating,comment,created_at)
                       VALUES (?,?,?,?,?,?,?)""", [
        (ids["q3"], "Mei Ling", "analyst", 7.5, "About right", "Data was clean; estimate held.", ts(wd(-3), 17)),
        (ids["churn"], "Sarah", "analyst", 11.0, "Too low", "Churn labels needed rework before modelling.", ts(wd(-1), 17)),
        (ids["mdash"], "Sarah", "analyst", 5.5, "About right", None, ts(wd(-5), 17)),
    ])
    cur.executemany("""INSERT INTO skill_adjustments (analyst_id,category,adjustment,reason,set_by,approved,created_at)
                       VALUES (?,?,?,?,?,?,?)""", [
        (4, "Modelling", 0.10, "Completed the internal ML course", "lead", 1, ts(wd(-20))),
        (5, "Dashboards", 0.15, "I'm comfortable with dashboards now", "Jun Wei", 0, ts(wd(-2))),
    ])

    # ── Pre-generated language outputs ─────────────────────────────────────────
    # Rule-based here so seeding never waits on an API; run `python -m fairqueue.db.pregenerate`
    # afterwards to replace them with LLM suggestions while the network is up.
    from fairqueue.llm import rule_priority
    for (tid, title, deadline) in cur.execute("SELECT id,title,deadline FROM tickets WHERE is_history=0").fetchall():
        out = rule_priority(deadline)
        cur.execute("INSERT INTO agent_cache (ticket_id,agent,output,method,created_at) VALUES (?,?,?,?,?)",
                    (tid, "priority", json.dumps(out), out["method"], ts(date.today())))

    con.commit()
    con.close()
    print(f"[ok] Database seeded at {path}")


def _seed_history(cur) -> None:
    """Closed past tickets so skill, track record and the forecast have history to learn from.
    Always the synthetic history: it uses the demo analysts' names."""
    from fairqueue.data.history import generate_synthetic
    from fairqueue.models.hours import predict_hours_rules
    names = {a[1]: a[0] for a in ANALYSTS}
    df = generate_synthetic()
    rows = []
    for r in df.itertuples():
        p = predict_hours_rules(r.category, r.priority)
        deadline = (r.created_at + timedelta(days=5 if r.priority in ("Low", "Medium") else 3)).date()
        rows.append((r.requester, r.division, f"{r.category} request #{r.ticket_id}", r.category, r.priority,
                     "Closed", names[r.assignee], deadline.isoformat(), p["low"], p["likely"], p["high"],
                     "rule-based", "High", r.actual_hours, 1,
                     r.created_at.strftime("%Y-%m-%d %H:%M:%S"), r.closed_at.strftime("%Y-%m-%d %H:%M:%S")))
    cur.executemany("""
        INSERT INTO tickets (requester,division,title,category,priority,status,assignee_id,deadline,
                             pred_low,pred_likely,pred_high,pred_method,confidence,actual_hours,is_history,
                             created_at,closed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, rows)


_MIN_PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R"
            b"/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
            b"4 0 obj<</Length 88>>stream\nBT /F1 18 Tf 72 720 Td (Q3 Sales Report - placeholder) Tj "
            b"0 -28 Td (Sales 8% above target.) Tj ET\nendstream endobj\n"
            b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
            b"trailer<</Root 1 0 R>>\n%%EOF\n")


def _write_upload(ticket_id: int, name: str, content: bytes) -> str:
    folder = UPLOADS_DIR / f"ticket_{ticket_id}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(content)
    return f"uploads/ticket_{ticket_id}/{name}"


def _seed_deliverables(cur, ids: dict[str, int]) -> None:
    q3 = _write_upload(ids["q3"], "Q3_sales_report.pdf", _MIN_PDF)
    churn = _write_upload(ids["churn"], "churn_analysis.csv",
                          b"segment,customers,churn_rate\nNew,1200,0.18\nEstablished,5400,0.07\nAt-risk,800,0.31\n")
    survey = _write_upload(ids["survey"], "engagement_survey_v1.csv",
                           b"question,score\nI feel valued,3.6\nI see a future here,3.4\n")
    rows = [
        (ids["q3"], 2, "File", "Q3 Sales Report", "Q3_sales_report.pdf", q3, None, "pdf",
         "Asked: Q3 sales against target. Found: 8% above target, driven by IT contracts. Next: review soft Finance renewals.",
         1, "Useful", None, ts(wd(-3), 16)),
        (ids["churn"], 4, "File", "Customer churn analysis", "churn_analysis.csv", churn, None, "csv",
         "Asked: who is churning. Found: the at-risk segment churns at 31%. Next: retention offer for at-risk customers.",
         1, None, None, ts(wd(-1), 16)),
        (ids["mdash"], 4, "Link", "Marketing performance dashboard", None, None,
         "https://lookerstudio.google.com/placeholder-marketing-dashboard", None,
         "Asked: one view of campaign performance. Built: Looker Studio dashboard refreshed daily. Next: add email channel.",
         1, "Useful", None, ts(wd(-5), 16)),
        (ids["vpnq"], 1, "None", "No deliverable", None, None, None, None,
         "Answered in the IT ops meeting: remote access usage is flat month on month.",
         1, "Useful", None, ts(wd(-4), 16)),
        (ids["survey"], 3, "File", "Engagement survey analysis", "engagement_survey_v1.csv", survey, None, "csv",
         "Asked: engagement survey results. Found: overall 3.5 of 5. Next: focus groups.",
         1, "Needs revision", "Please split the results by department and tenure band.", ts(wd(-2), 16)),
    ]
    cur.executemany("""INSERT INTO deliverables (ticket_id,uploaded_by,kind,title,file_name,file_path,url,file_type,
                                                 summary,version,requester_rating,revision_note,uploaded_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""", rows)


if __name__ == "__main__":
    seed()
