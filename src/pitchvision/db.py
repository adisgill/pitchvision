"""DuckDB helpers. Parquet under ``data/parquet/<schema>/<table>.parquet`` is the durable
copy; the DuckDB file holds views over it and rebuilds in seconds.

Lessons carried from courtvision: one connection refuses concurrent queries (give each
thread its own ``cursor()``), and a database already open in this process is reused for
the same path, so never write a new file over a path that is open.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb

from pitchvision.config import Paths, get_paths

log = logging.getLogger(__name__)


def connect(paths: Paths | None = None, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    paths = paths or get_paths()
    paths.data.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(paths.duckdb), read_only=read_only)


def parquet_path(paths: Paths, schema: str, table: str) -> Path:
    return paths.parquet / schema / f"{table}.parquet"


def materialize(con: duckdb.DuckDBPyConnection, paths: Paths, schema: str, table: str,
                sql: str) -> int:  # fmt: skip
    """Write ``sql``'s result to Parquet and (re)point the view ``schema.table`` at it.
    Returns the row count."""
    p = parquet_path(paths, schema, table)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".parquet.tmp")
    con.execute(f"copy ({sql}) to '{tmp.as_posix()}' (format parquet, compression zstd)")
    tmp.replace(p)
    con.execute(f"create schema if not exists {schema}")
    con.execute(f"create or replace view {schema}.{table} as "
                f"select * from read_parquet('{p.as_posix()}')")  # fmt: skip
    return con.execute(f"select count(*) from {schema}.{table}").fetchall()[0][0]


def has_table(con: duckdb.DuckDBPyConnection, schema: str, table: str) -> bool:
    return bool(con.execute(
        "select count(*) from information_schema.tables where table_schema = ? and "
        "table_name = ?", [schema, table]).fetchall()[0][0])  # fmt: skip


@contextmanager
def stage(name: str) -> Iterator[None]:
    """Log a build stage's wall time."""
    t = time.perf_counter()
    log.info("%s ...", name)
    yield
    log.info("%s done in %.1f s", name, time.perf_counter() - t)
