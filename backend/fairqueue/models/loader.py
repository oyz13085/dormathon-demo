"""Load pickled model files from backend/artifacts/. Returns None if missing."""
import os
import pickle
from typing import Any

from fairqueue.config import ARTIFACTS_DIR

_cache: dict[str, Any] = {}


def load_model(filename: str) -> Any | None:
    if filename in _cache:
        return _cache[filename]
    path = os.path.join(ARTIFACTS_DIR, filename)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as f:
            model = pickle.load(f)
        _cache[filename] = model
        return model
    except Exception:
        return None


def clear_cache() -> None:
    _cache.clear()
