"""
Train the hours model (LightGBM quantile: low/likely/high) and the handover model
(LightGBM classifier) on the history's training period, and score both on the
test period against simple baselines.

Run from backend/:  python -m fairqueue.models.train
Writes artifacts/hours_model.pkl, artifacts/handover_model.pkl, artifacts/model_report.json
"""
from __future__ import annotations
import json
import pickle
import numpy as np
import pandas as pd
from fairqueue.config import ARTIFACTS_DIR, PRIORITIES, DEPARTMENTS
from fairqueue.data.history import load_history, split

QUANTILES = {"low": 0.1, "likely": 0.5, "high": 0.9}
MIN_CATEGORY_COUNT = 5     # fewer training tickets than this → low confidence


def ticket_features(df: pd.DataFrame, categories: list[str]) -> pd.DataFrame:
    created = pd.to_datetime(df["created_at"])
    X = pd.DataFrame({
        "category": pd.Categorical(df["category"], categories=categories),
        "priority": pd.Categorical(df["priority"], categories=PRIORITIES),
        "division": pd.Categorical(df["division"], categories=DEPARTMENTS),
        "month_end": (created.dt.day >= 24).astype(int).values,
    })
    return X


def experience_before(df: pd.DataFrame) -> pd.Series:
    """How many tickets of this category the assignee had closed before this one."""
    seen: dict[tuple[str, str], int] = {}
    out = []
    for a, c in zip(df["assignee"], df["category"]):
        out.append(seen.get((a, c), 0))
        seen[(a, c)] = seen.get((a, c), 0) + 1
    return pd.Series(out, index=df.index)


def train_all(extra_closed: pd.DataFrame | None = None) -> dict:
    """extra_closed: closed tickets from the live database (with feedback/actual hours),
    appended to the training period so feedback feeds retraining."""
    import lightgbm as lgb

    df, source = load_history()
    df = df.copy()
    df["experience"] = experience_before(df)
    train, test = split(df)
    if extra_closed is not None and len(extra_closed):
        train = pd.concat([train, extra_closed], ignore_index=True)

    categories = sorted(set(train["category"].astype(str)))
    cat_counts = train["category"].value_counts().to_dict()
    # Small data: shallow trees, large leaves, few rounds
    params = dict(n_estimators=150, learning_rate=0.05, num_leaves=7,
                  min_child_samples=15, reg_lambda=1.0, random_state=42, verbose=-1)

    # ── Hours model ────────────────────────────────────────────────────────────
    Xtr, ytr = ticket_features(train, categories), np.log1p(train["actual_hours"].astype(float))
    hours_models = {}
    for name, q in QUANTILES.items():
        m = lgb.LGBMRegressor(objective="quantile", alpha=q, **params)
        m.fit(Xtr, ytr)
        hours_models[name] = m

    Xte, yte = ticket_features(test, categories), test["actual_hours"].astype(float).values
    preds = {k: np.expm1(m.predict(Xte)) for k, m in hours_models.items()}
    cat_median = train.groupby("category")["actual_hours"].median()
    baseline = test["category"].map(cat_median).fillna(train["actual_hours"].median()).values
    mae_model = float(np.mean(np.abs(preds["likely"] - yte)))
    mae_base = float(np.mean(np.abs(baseline - yte)))
    lo = np.minimum(preds["low"], preds["likely"])
    hi = np.maximum(preds["high"], preds["likely"])
    coverage = float(np.mean((yte >= lo) & (yte <= hi)))

    # ── Handover model ─────────────────────────────────────────────────────────
    def ho_features(d):
        X = ticket_features(d, categories)
        X["experience"] = d["experience"].fillna(0).values
        return X
    ho = lgb.LGBMClassifier(**params)
    ytr_h = (train["handovers"].fillna(0) > 0).astype(int)
    ho.fit(ho_features(train), ytr_h)
    yte_h = (test["handovers"].fillna(0) > 0).astype(int).values
    p_h = ho.predict_proba(ho_features(test))[:, 1]
    base_rate = float(ytr_h.mean())
    brier_model = float(np.mean((p_h - yte_h) ** 2))
    brier_base = float(np.mean((base_rate - yte_h) ** 2))

    ARTIFACTS_DIR.mkdir(exist_ok=True)
    with open(ARTIFACTS_DIR / "hours_model.pkl", "wb") as f:
        pickle.dump({"models": hours_models, "categories": categories,
                     "category_counts": cat_counts,
                     "category_median": cat_median.to_dict()}, f)
    with open(ARTIFACTS_DIR / "handover_model.pkl", "wb") as f:
        pickle.dump({"model": ho, "categories": categories, "base_rate": base_rate}, f)

    report = {
        "data_source": source,
        "n_train": int(len(train)), "n_test": int(len(test)),
        "hours": {
            "mae_model": round(mae_model, 2), "mae_category_median": round(mae_base, 2),
            "beats_baseline": mae_model < mae_base,
            "interval_coverage_low_high": round(coverage, 2),
        },
        "handover": {
            "brier_model": round(brier_model, 4), "brier_base_rate": round(brier_base, 4),
            "beats_baseline": brier_model < brier_base, "base_rate": round(base_rate, 3),
        },
    }
    with open(ARTIFACTS_DIR / "model_report.json", "w") as f:
        json.dump(report, f, indent=2)

    from fairqueue.models.loader import clear_cache
    clear_cache()
    return report


if __name__ == "__main__":
    print(json.dumps(train_all(), indent=2))
