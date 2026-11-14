"""Paths and environment. Everything on disk hangs off one data directory."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Paths:
    """Layout of the (gitignored) data directory."""

    data: Path

    @property
    def raw(self) -> Path:
        """Files exactly as downloaded, one folder per source, each with a manifest. Never
        edited."""
        return self.data / "raw"

    @property
    def parquet(self) -> Path:
        return self.data / "parquet"

    @property
    def duckdb(self) -> Path:
        return self.data / "pitchvision.duckdb"

    def source(self, name: str) -> Path:
        return self.raw / name


def load_env() -> None:
    """Load ``.env`` from the repo root without overriding real env vars."""
    load_dotenv(REPO_ROOT / ".env", override=False)


def get_paths() -> Paths:
    load_env()
    raw = os.environ.get("PITCHVISION_DATA_DIR")
    data = Path(raw).expanduser() if raw else REPO_ROOT / "data"
    if not data.is_absolute():
        data = REPO_ROOT / data
    return Paths(data=data)
