"""The only module that touches the network. Every download is rate-limited, cached on
disk, and recorded in its source's ``manifest.jsonl`` (source, url, fetched_at UTC, bytes,
sha256). ``build`` never imports this module.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx

USER_AGENT = (
    "pitchvision/0.0 (personal, non-commercial soccer research; +https://github.com/adisgill)"
)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class Fetcher:
    """Downloads into ``root`` (one source's raw folder) at most one request per
    ``min_interval`` seconds. Files already on disk are not fetched again unless
    ``refresh``."""

    source: str
    root: Path
    min_interval: float = 2.0
    timeout: float = 120.0
    _last: float = field(default=0.0, repr=False)

    def __post_init__(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=self.timeout, follow_redirects=True
        )

    @property
    def manifest(self) -> Path:
        return self.root / "manifest.jsonl"

    def get(self, url: str, rel: str, refresh: bool = False, retries: int = 3) -> Path:
        """Download ``url`` to ``root/rel``. A ``rel`` ending in ``.gz`` for a URL that
        doesn't is stored gzip-compressed (the bytes are otherwise untouched); the manifest
        then also records the sha256 of the content as served."""
        dest = self.root / rel
        if dest.exists() and not refresh:
            return dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        compress = rel.endswith(".gz") and not url.split("?")[0].endswith(".gz")
        content_hash = None
        for attempt in range(retries):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                tmp = dest.with_suffix(dest.suffix + ".part")
                h = hashlib.sha256()
                with self.client.stream("GET", url) as r:
                    r.raise_for_status()
                    opener = gzip.open if compress else open
                    with opener(tmp, "wb") as f:
                        for chunk in r.iter_bytes(1 << 16):
                            h.update(chunk)
                            f.write(chunk)
                tmp.replace(dest)
                content_hash = h.hexdigest() if compress else None
                break
            except (httpx.HTTPError, OSError):
                if attempt == retries - 1:
                    raise
                time.sleep(5 * (attempt + 1))
        self._record(url, rel, dest, content_hash)
        return dest

    def _record(self, url: str, rel: str, dest: Path, content_hash: str | None = None) -> None:
        row = {
            "source": self.source,
            "url": url,
            "path": rel.replace("\\", "/"),
            "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "bytes": dest.stat().st_size,
            "sha256": sha256(dest),
        }
        if content_hash:
            row["content_sha256"] = content_hash
        with self.manifest.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(row) + "\n")

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> Fetcher:
        return self

    def __exit__(self, *exc) -> None:
        self.close()
