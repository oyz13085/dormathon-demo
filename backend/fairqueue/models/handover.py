"""
Chance that a ticket will be handed over if given to a particular analyst.
Primary: LightGBM classifier (category, priority, division, analyst's experience
with this category). Fallback: rule on experience.
"""
from __future__ import annotations
from datetime import datetime
import pandas as pd
from fairqueue.models.loader import load_model


def predict_handover(category: str, priority: str, division: str, experience: int) -> float:
    bundle = load_model("handover_model.pkl")
    if bundle is None:
        return 0.25 if experience == 0 else 0.05
    from fairqueue.models.train import ticket_features
    X = ticket_features(pd.DataFrame([{"category": category, "priority": priority,
                                       "division": division,
                                       "created_at": datetime.now().isoformat(sep=" ")}]),
                        bundle["categories"])
    X["experience"] = experience
    return round(float(bundle["model"].predict_proba(X)[0][1]), 3)
