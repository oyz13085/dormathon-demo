"""
Replace the seeded rule-based priority suggestions with LLM ones, so the live demo
reads them from the database instead of waiting on the API.

Run after seeding, while the network is up:  python -m fairqueue.db.pregenerate
"""
from fairqueue.db import repo
from fairqueue.llm import suggest_priority


def pregenerate() -> dict:
    counts = {"llm": 0, "rule-based": 0}
    for t in repo.get_tickets():
        out = suggest_priority(t["title"], t.get("description") or "", t["division"], t["deadline"])
        repo.cache_agent_output(t["id"], "priority", out, out["method"])
        counts[out["method"]] = counts.get(out["method"], 0) + 1
    return counts


if __name__ == "__main__":
    print(pregenerate())
