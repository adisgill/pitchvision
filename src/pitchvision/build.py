"""``pitchvision build``: rebuild every table from the raw caches. Never touches the network
(this module must not import ``pitchvision.ingest``)."""

from __future__ import annotations

import logging

from pitchvision import quality
from pitchvision.config import get_paths
from pitchvision.db import connect, has_table, stage

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
            with stage("metrics + ratings: tier C players"):
                from pitchvision.metrics import players

                out["players"] = players.build(con, paths)
            with stage("ratings: impact (goal RAPM with box prior)"):
                from pitchvision.ratings import rapm

                out["rapm"] = rapm.build(con, paths)
        if (paths.source("wyscout") / "events" / "events.zip").exists():
            with stage("stg: wyscout"):
                from pitchvision.stg import wyscout

                out["wyscout"] = wyscout.build(con, paths)
        if any(paths.source("statsbomb").glob("*/matches")):
            with stage("stg: statsbomb"):
                from pitchvision.stg import statsbomb

                out["statsbomb"] = statsbomb.build(con, paths)
        with stage("stg: unified actions view"):
            parts = [f"select * from stg.{p}_actions" for p in ("wy", "sb")
                     if has_table(con, "stg", f"{p}_actions")]  # fmt: skip
            if parts:
                con.execute("create or replace view stg.actions as "
                            + " union all by name ".join(parts))  # fmt: skip
        if has_table(con, "stg", "actions"):
            with stage("models: xG (fit leave-one-season-out, then all shots)"):
                from pitchvision.models import xg

                out["xg"] = xg.build(con, paths)
        if (paths.source("footballdata") / "notes.txt").exists():
            with stage("stg: football-data.co.uk"):
                from pitchvision.stg import footballdata

                out["footballdata"] = footballdata.build(con, paths)
        if has_table(con, "stg", "tm_games"):
            with stage("core: crosswalk"):
                from pitchvision.core import crosswalk

                out["crosswalk"] = crosswalk.build(con, paths)
        if has_table(con, "stg", "fd_matches") and has_table(con, "core", "crosswalk"):
            with stage("core: team matches"):
                from pitchvision.core import team_matches

                out["team_matches"] = team_matches.build(con, paths)
            with stage("forecast: walk-forward (team models vs the closing line)"):
                from pitchvision.forecast import walkforward

                out["walkforward"] = walkforward.build(con, paths)
            with stage("ratings: teams (Dixon-Coles, Elo, market)"):
                from pitchvision.ratings import team

                out["team_ratings"] = team.build(con, paths)
            with stage("forecast: season simulator (current season + halfway backtest)"):
                from pitchvision.forecast import season

                out["season_sim"] = season.build(con, paths)
            with stage("ratings: age curves, league strength, market value"):
                from pitchvision.ratings import aging, league, market

                out["aging"] = aging.build(con, paths)
                out["league"] = league.build(con, paths)
                out["market"] = market.build(con, paths)
        if has_table(con, "metrics", "shots"):
            with stage("models: expected threat"):
                from pitchvision.models import xt

                out["xt"] = xt.build(con, paths)
            with stage("models: VAEP action values (out of fold)"):
                from pitchvision.models import vaep

                out["vaep"] = vaep.build(con, paths)
            with stage("metrics: tier-A minutes and player-seasons"):
                from pitchvision.metrics import minutes_a, players_a

                out["minutes_a"] = minutes_a.build(con, paths)
                out["players_a"] = players_a.build(con, paths)
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
