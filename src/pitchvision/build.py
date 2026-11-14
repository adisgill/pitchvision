"""``pitchvision build``: rebuild every table from the raw caches. Never touches the network
(this module must not import ``pitchvision.ingest``)."""

from __future__ import annotations

import logging

from pitchvision import quality
from pitchvision.config import get_paths
from pitchvision.db import connect, stage

log = logging.getLogger(__name__)


class QualityError(RuntimeError):
    pass


def run(strict: bool = True) -> dict:
    paths = get_paths()
    out: dict = {}
    with connect(paths) as con:
        if (paths.source("transfermarkt") / "games.csv.gz").exists():
            with stage("stg: transfermarkt"):
                from pitchvision.stg import transfermarkt

                out["transfermarkt"] = transfermarkt.build(con, paths)
            with stage("metrics: stints"):
                from pitchvision.metrics import stints

                out["stints"] = stints.build(con, paths)
        if (paths.source("wyscout") / "events" / "events.zip").exists():
            with stage("stg: wyscout"):
                from pitchvision.stg import wyscout

                out["wyscout"] = wyscout.build(con, paths)
        with stage("qa: data-quality checks"):
            qa = quality.run(con)
            con.execute("create schema if not exists qa")
            con.register("qa_df", qa)
            con.execute("create or replace table qa.checks as select * from qa_df")
            con.unregister("qa_df")
        failed = qa[(~qa.passed) & qa.blocking] if len(qa) else qa
        out["qa"] = {"checks": len(qa), "failed": len(failed)}
        for r in failed.itertuples():
            log.warning("QA FAIL %s [%s]: %.4f (threshold %s)", r.check, r.scope, r.value,
                        r.threshold)  # fmt: skip
    if strict and len(failed):
        raise QualityError(f"{len(failed)} blocking data-quality checks failed (see qa.checks)")
    return out
