"""
Train the hours model and the handover model (LightGBM classifier) on the history's
training period, and score both on the test period against simple baselines.

Hours: two candidates, chosen on the last quarter of the training period (never the test):
  lightgbm   LightGBM quantile regression (low / likely / high)
  empirical  category median × priority ratio, with a low/high range from the residuals
Either way, once an analyst is known their measured speed on the category is applied
(past-only, shrunk toward 1 so a few tickets can't swing it). With little data the
empirical model usually wins; with a large history LightGBM can.

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
SHRINK = 3                 # analyst effect: pseudo-tickets at "average speed"


def ticket_features(df: pd.DataFrame, categories: list[str]) -> pd.DataFrame:
    created = pd.to_datetime(df["created_at"])
    X = pd.DataFrame({
        "category": pd.Categorical(df["category"], categories=categories),
        "priority": pd.Categorical(df["priority"], categories=PRIORITIES),
        "division": pd.Categorical(df["division"], categories=DEPARTMENTS),
        "month_end": (created.dt.day >= 24).astype(int).values,
    })
    return X


def fit_empirical(d: pd.DataFrame) -> dict:
    """Category median × priority ratio, a residual band for low/high, and each analyst's
    speed on each category relative to that (log-ratio mean shrunk toward 0)."""
    hours = d["actual_hours"].astype(float)
    cat_med = hours.groupby(d["category"]).median()
    base = d["category"].map(cat_med)
    pri = (hours / base).groupby(d["priority"]).median()
    expected = base * d["priority"].map(pri).fillna(1.0)
    log_ratio = np.log(hours / expected)
    effects = {}
    for (a, c), lr in log_ratio.groupby([d["assignee"], d["category"]]):
        effects[f"{a}|{c}"] = float(np.exp(lr.sum() / (len(lr) + SHRINK)))
    emp = {"cat_median": cat_med.to_dict(), "priority_ratio": pri.to_dict(),
           "overall_median": float(hours.median()), "effects": effects}
    # Range: 10th / 90th percentile of what's left after the analyst effect
    resid = np.log(hours / (expected * pd.Series([analyst_effect(emp, a, c) for a, c in zip(d["assignee"], d["category"])], index=d.index)))
    emp["band"] = (float(np.exp(np.quantile(resid, 0.1))), float(np.exp(np.quantile(resid, 0.9))))
    return emp


def empirical_likely(emp: dict, categories, priorities) -> np.ndarray:
    return np.array([emp["cat_median"].get(c, emp["overall_median"]) * emp["priority_ratio"].get(p, 1.0)
                     for c, p in zip(categories, priorities)])


def analyst_effect(emp: dict | None, analyst: str | None, category: str) -> float:
    """How fast this analyst usually is on this category (1.0 = typical; 1.3 = takes 30% longer)."""
    if not emp or not analyst:
        return 1.0
    return float(emp["effects"].get(f"{analyst}|{category}", 1.0))


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
    def fit_lgb(d):
        X, y = ticket_features(d, categories), np.log1p(d["actual_hours"].astype(float))
        return {name: lgb.LGBMRegressor(objective="quantile", alpha=q, **params).fit(X, y) for name, q in QUANTILES.items()}

    def predict_lgb(models, d):
        X = ticket_features(d, categories)
        return {k: np.expm1(m.predict(X)) for k, m in models.items()}

    def predict_emp(emp, d):
        likely = empirical_likely(emp, d["category"], d["priority"])
        return {"low": likely * emp["band"][0], "likely": likely, "high": likely * emp["band"][1]}

    def with_analyst(emp, d, preds):
        f = np.array([analyst_effect(emp, a, c) for a, c in zip(d["assignee"], d["category"])])
        return {k: v * f for k, v in preds.items()}

    yte = test["actual_hours"].astype(float).values
    mae = lambda p, y: float(np.mean(np.abs(p - y)))

    # Choose on the last quarter of the training period
    cut = int(len(train) * 0.75)
    fit_part, val = train.iloc[:cut], train.iloc[cut:]
    yval = val["actual_hours"].astype(float).values
    emp_fit = fit_empirical(fit_part)
    val_scores = {"lightgbm": mae(with_analyst(emp_fit, val, predict_lgb(fit_lgb(fit_part), val))["likely"], yval),
                  "empirical": mae(with_analyst(emp_fit, val, predict_emp(emp_fit, val))["likely"], yval)}
    method = min(val_scores, key=val_scores.get)

    # Refit both on the whole training period and score on the test period
    emp = fit_empirical(train)
    hours_models = fit_lgb(train)
    test_lgb, test_emp = predict_lgb(hours_models, test), predict_emp(emp, test)
    chosen = test_lgb if method == "lightgbm" else test_emp
    preds = with_analyst(emp, test, chosen)       # the analyst is known at assignment time
    cat_median = train.groupby("category")["actual_hours"].median()
    baseline = test["category"].map(cat_median).fillna(train["actual_hours"].median()).values
    mae_model = mae(preds["likely"], yte)
    mae_base = mae(baseline, yte)
    lo = np.minimum(preds["low"], preds["likely"])
    hi = np.maximum(preds["high"], preds["likely"])
    coverage = float(np.mean((yte >= lo) & (yte <= hi)))
    comparison = {"category_median": round(mae_base, 2),
                  "lightgbm": round(mae(test_lgb["likely"], yte), 2),
                  "empirical": round(mae(test_emp["likely"], yte), 2),
                  "chosen_before_assignment": round(mae(chosen["likely"], yte), 2),
                  "chosen_with_analyst": round(mae_model, 2)}

    # ── Handover model ─────────────────────────────────────────────────────────
    def ho_features(d):
        X = ticket_features(d, categories)
        X["experience"] = d["experience"].fillna(0).values
        return X
    # Two candidates again, chosen on the last quarter of the training period:
    #   lightgbm   classifier on ticket features + the analyst's experience with the category
    #   empirical  the analyst's own handover rate on the category, shrunk to the overall rate
    def handed(d):
        return (d["handovers"].fillna(0) > 0).astype(int)

    def fit_ho_emp(d):
        y = handed(d)
        base = float(y.mean())
        rates = {f"{a}|{c}": float((g.sum() + SHRINK * base) / (len(g) + SHRINK))
                 for (a, c), g in y.groupby([d["assignee"], d["category"]])}
        return {"base": base, "rates": rates}

    def predict_ho_emp(m, d):
        return np.array([m["rates"].get(f"{a}|{c}", m["base"]) for a, c in zip(d["assignee"], d["category"])])

    def fit_ho_lgb(d):
        return lgb.LGBMClassifier(**params).fit(ho_features(d), handed(d))

    brier = lambda p, y: float(np.mean((p - y) ** 2))
    ho_val = {"lightgbm": brier(fit_ho_lgb(fit_part).predict_proba(ho_features(val))[:, 1], handed(val).values),
              "empirical": brier(predict_ho_emp(fit_ho_emp(fit_part), val), handed(val).values)}
    ho_method = min(ho_val, key=ho_val.get)
    ho = fit_ho_lgb(train)
    ho_emp = fit_ho_emp(train)
    ytr_h = handed(train)
    yte_h = handed(test).values
    p_h = ho.predict_proba(ho_features(test))[:, 1] if ho_method == "lightgbm" else predict_ho_emp(ho_emp, test)
    base_rate = float(ytr_h.mean())
    brier_model = brier(p_h, yte_h)
    brier_base = brier(np.full(len(yte_h), base_rate), yte_h)

    ARTIFACTS_DIR.mkdir(exist_ok=True)
    with open(ARTIFACTS_DIR / "hours_model.pkl", "wb") as f:
        pickle.dump({"models": hours_models, "categories": categories,
                     "category_counts": cat_counts,
                     "category_median": cat_median.to_dict(),
                     "method": method, "empirical": emp}, f)
    with open(ARTIFACTS_DIR / "handover_model.pkl", "wb") as f:
        pickle.dump({"model": ho, "categories": categories, "base_rate": base_rate,
                     "method": ho_method, "empirical": ho_emp}, f)

    report = {
        "data_source": source,
        "n_train": int(len(train)), "n_test": int(len(test)),
        "hours": {
            "mae_model": round(mae_model, 2), "mae_category_median": round(mae_base, 2),
            "beats_baseline": mae_model < mae_base,
            "interval_coverage_low_high": round(coverage, 2),
            "method": method, "validation_mae": {k: round(v, 2) for k, v in val_scores.items()},
            "test_mae": comparison,
        },
        "handover": {
            "brier_model": round(brier_model, 4), "brier_base_rate": round(brier_base, 4),
            "beats_baseline": brier_model < brier_base, "base_rate": round(base_rate, 3),
            "method": ho_method, "validation_brier": {k: round(v, 4) for k, v in ho_val.items()},
        },
    }
    with open(ARTIFACTS_DIR / "model_report.json", "w") as f:
        json.dump(report, f, indent=2)

    from fairqueue.models.loader import clear_cache
    clear_cache()
    return report


if __name__ == "__main__":
    print(json.dumps(train_all(), indent=2))
