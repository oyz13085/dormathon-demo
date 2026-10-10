"""
Make one real AI call (Groq) through the leave advisor and print what happened. Read-only: it runs the same
analysis as POST /leave-advisor/preview and saves nothing (no leave request, no plan).

    cd backend
    (put GROQ_API_KEY=gsk_... in backend/.env first)
    .venv\\Scripts\\python -m fairqueue.leave_advisor.live_check "Mei Ling" 2026-10-12 2026-10-16

A real call prints `source: ai`, the model, and one Groq request ID per API request.
Those IDs also appear in the backend log, and the calls show up in console.groq.com under Logs/Usage.
"""
from __future__ import annotations
import json
import logging
import sys
from fairqueue.db import repo
from fairqueue.leave_advisor import plan


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    name, start, end = argv
    analyst = repo.get_analyst_by_name(name)
    if not analyst:
        print(f"No analyst called {name!r}")
        return 2
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")      # model text can include any character
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    p = plan.build(analyst["id"], start, end, {}, use_cache=False)
    if not p["valid"]:
        print("Invalid leave dates:", " ".join(p["errors"]))
        return 1
    ai = p["ai"]
    print(f"source: {p['source']}   ai: {ai['status']} ({ai['provider']})   model: {ai['model']}   turns: {ai['turns']}")
    print(f"request ids: {', '.join(ai['request_ids']) or 'none (no API request was made)'}")
    if ai["reason"]:
        print(f"reason: {ai['reason']}")
    for t in p["tickets"]:
        rec = t["recommended"]["name"] if t["recommended"] else "none"
        print(f"  #{t['ticket_id']} {t['title']} (due {t['deadline']}): {rec} [{t['decided_by']}, feasible: {t['handover_feasible']}]")
        print(f"      {t['reason']}")
    return 0 if p["source"] in ("ai", "none_needed") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
