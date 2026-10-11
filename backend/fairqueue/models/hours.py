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


def analyst_factor(analyst: str | None, category: str) -> float:
    """Measured speed of this analyst on this category (1.0 when unknown or no model)."""
    bundle = load_model("hours_model.pkl")
    if not bundle or not analyst:
        return 1.0
    from fairqueue.models.train import analyst_effect
    return analyst_effect(bundle.get("empirical"), analyst, category)


def predict_hours(category: str, priority: str, division: str,
                  created_at: str | None = None, analyst: str | None = None) -> dict:
    """Hours for a ticket. With `analyst`, adjusted for how fast that analyst usually is on the type."""
    bundle = load_model("hours_model.pkl")
    if bundle is None:
        return predict_hours_rules(category, priority)

    from fairqueue.models.train import ticket_features, empirical_likely, analyst_effect, MIN_CATEGORY_COUNT
    n_seen = bundle["category_counts"].get(category, 0)
    if n_seen < MIN_CATEGORY_COUNT:
        # Unfamiliar ticket type: no confident guess. Wide range around the overall median.
        overall = float(np.median(list(bundle["category_median"].values())))
        likely = round(overall * PRIORITY_MULTIPLIER.get(priority, 1.0), 1)
        return {"low": round(likely * 0.4, 1), "likely": likely, "high": round(likely * 2.5, 1),
                "confidence": "Low", "method": "model"}

    emp = bundle.get("empirical")
    if bundle.get("method") == "empirical" and emp:
        likely = float(empirical_likely(emp, [category], [priority])[0])
        vals = {"low": likely * emp["band"][0], "likely": likely, "high": likely * emp["band"][1]}
    else:
        created = created_at or datetime.now().isoformat(sep=" ")
        X = ticket_features(pd.DataFrame([{"category": category, "priority": priority,
                                           "division": division, "created_at": created}]),
                            bundle["categories"])
        vals = {k: float(np.expm1(m.predict(X)[0])) for k, m in bundle["models"].items()}
    f = analyst_effect(emp, analyst, category)
    low, likely, high = sorted([vals["low"] * f, vals["likely"] * f, vals["high"] * f])
    return {"low": round(max(low, 0.5), 1), "likely": round(max(likely, 1.0), 1),
            "high": round(max(high, likely), 1), "confidence": "High", "method": "model"}
