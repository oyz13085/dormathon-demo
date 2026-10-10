"""Loads config.yaml once. Everything tunable lives there."""
from __future__ import annotations
import os
from pathlib import Path
import yaml
from dotenv import load_dotenv

load_dotenv()

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", BACKEND_DIR / "uploads"))

with open(BACKEND_DIR / "config.yaml", encoding="utf-8") as _f:
    CONFIG: dict = yaml.safe_load(_f)

LLM = CONFIG["llm"]
HOURS_PER_DAY: float = CONFIG["work"]["hours_per_day"]
HANDOVER_BUFFER_HOURS: float = CONFIG["work"]["handover_buffer_hours"]
ALERT_THRESHOLD: float = CONFIG["alerts"]["threshold"]
ALERTS_PER_DAY: int = CONFIG["alerts"]["max_per_day"]
SERVICE_TARGET_MULTIPLIER: float = CONFIG["service_target_multiplier"]
HISTORY = CONFIG["history"]

DEPARTMENTS = ["HR", "IT", "Finance", "Marketing"]
PRIORITIES = ["Low", "Medium", "High", "Critical"]
