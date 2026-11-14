"""The fetcher caches, records a manifest row per download, and never re-downloads."""

import json

import httpx

from pitchvision.ingest.fetch import Fetcher, sha256


def _fetcher(tmp_path, calls):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"a,b\n1,2\n")

    f = Fetcher("test", tmp_path, min_interval=0)
    f.client = httpx.Client(transport=httpx.MockTransport(handler))
    return f


def test_download_writes_file_and_manifest(tmp_path):
    calls = []
    with _fetcher(tmp_path, calls) as f:
        p = f.get("https://example.test/x.csv", "sub/x.csv")
    assert p.read_bytes() == b"a,b\n1,2\n"
    row = json.loads((tmp_path / "manifest.jsonl").read_text().strip())
    assert row["source"] == "test" and row["path"] == "sub/x.csv"
    assert row["bytes"] == 8 and row["sha256"] == sha256(p)
    assert row["fetched_at"].endswith("+00:00")  # UTC


def test_cached_file_is_not_fetched_again(tmp_path):
    calls = []
    with _fetcher(tmp_path, calls) as f:
        f.get("https://example.test/x.csv", "x.csv")
        f.get("https://example.test/x.csv", "x.csv")
        assert len(calls) == 1
        f.get("https://example.test/x.csv", "x.csv", refresh=True)
        assert len(calls) == 2
    assert len((tmp_path / "manifest.jsonl").read_text().splitlines()) == 2
