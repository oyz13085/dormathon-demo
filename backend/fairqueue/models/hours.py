"""
Hours prediction: low / likely / high.
Primary: LightGBM quantile models trained by fairqueue.models.train.
Fallback: category medians, labelled "rule-based".
Confidence is Low when the ticket type has (almost) never been seen before,
and the range is widened instead of guessed.
"""
from __future__ import annotations
from datetime import datetime
import numpy as np
import pandas as pd
from fairqueue.models.loader import load_model

CATEGORY_MEDIANS: dict[str, float] = {
    "Reporting": 5.5, "Modelling": 11.0, "Automation": 5.0,
    "Dashboards": 6.0, "Documentation": 3.5,
}
PRIORITY_MULTIPLIER = {"Low": 0.8, "Medium": 1.0, "High": 1.2, "Critical": 1.4}


def predict_hours_rules(category: str, priority: str) -> dict:
    known = category in CATEGORY_MEDIANS
    median = CATEGORY_MEDIANS.get(category, 8.0)
    likely = round(median * PRIORITY_MULTIPLIER.get(priority, 1.0), 1)
    lo, hi = (0.6, 1.7) if known else (0.4, 2.5)
    return {"low": round(likely * lo, 1), "likely": likely, "high": round(likely * hi, 1),
            "confidence": "High" if known else "Low", "method": "rule-based"}


def known_categories() -> list[str]:
    bundle = load_model("hours_model.pkl")
    if bundle:
        from fairqueue.models.train import MIN_CATEGORY_COUNT
        return [c for c, n in bundle["category_counts"].items() if n >= MIN_CATEGORY_COUNT]
    return list(CATEGORY_MEDIANS)


def predict_hours(category: str, priority: str, division: str,
                  created_at: str | None = None) -> dict:
    bundle = load_model("hours_model.pkl")
    if bundle is None:
        return predict_hours_rules(category, priority)

    from fairqueue.models.train import ticket_features, MIN_CATEGORY_COUNT
    n_seen = bundle["category_counts"].get(category, 0)
    if n_seen < MIN_CATEGORY_COUNT:
        # Unfamiliar ticket type: no confident guess. Wide range around the overall median.
        overall = float(np.median(list(bundle["category_median"].values())))
        likely = round(overall * PRIORITY_MULTIPLIER.get(priority, 1.0), 1)
        return {"low": round(likely * 0.4, 1), "likely": likely, "high": round(likely * 2.5, 1),
                "confidence": "Low", "method": "model"}

    created = created_at or datetime.now().isoformat(sep=" ")
    X = ticket_features(pd.DataFrame([{"category": category, "priority": priority,
                                       "division": division, "created_at": created}]),
                        bundle["categories"])
    vals = {k: float(np.expm1(m.predict(X)[0])) for k, m in bundle["models"].items()}
    low, likely, high = sorted([vals["low"], vals["likely"], vals["high"]])
    return {"low": round(max(low, 0.5), 1), "likely": round(max(likely, 1.0), 1),
            "high": round(max(high, likely), 1), "confidence": "High", "method": "model"}
