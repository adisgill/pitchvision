"""The identity crosswalk (docs/phase0/identity_plan.md): every club, match and player of
StatsBomb and Wyscout mapped to a canonical id, with the method and confidence of each
mapping, and a QA table of everything unmatched or doubtful. Nothing merges silently.

Canonical ids are ``tm-<id>`` for anything Transfermarkt has (the spine) and
``<source>-<id>`` otherwise (women's clubs and players, which TM's mirror lacks). They are
stable across rebuilds without a registry. (*Change, Nov 14*: the plan said
``pv_<entity>_<n>``; source-prefixed ids are stable by construction and readable.)

Order: clubs (by fixture voting: a source match and a TM match on the same date ±1 day in
the same competition vote for each other's clubs; names only confirm), then matches,
then players (optimal assignment within each matched team-match on names, shirt number
and date of birth where the source has one, then votes across matches).
"""

from __future__ import annotations

import unicodedata
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process
from scipy.optimize import linear_sum_assignment

from pitchvision.config import OVERRIDES, Paths
from pitchvision.db import has_table, materialize

STOP = {"fc", "cf", "afc", "ac", "sc", "sv", "ssc", "as", "ud", "cd", "rcd", "vfl", "vfb",
        "tsg", "calcio", "club", "de", "futbol", "football", "1", "us", "ogc", "rc", "sd",
        "aca", "bc", "hsc", "real", "the", "1899", "1846", "1848", "1860", "1900", "1904",
        "1907", "1909", "1913", "05", "04", "96", "hellas", "stade", "olympique"}  # fmt: skip
CLUB_VOTE_SHARE = 0.9
PLAYER_MIN_SCORE = 60.0


def norm(s: str | None, stop: bool = False) -> str:
    """Accent-folded, lower-case, punctuation-free; optionally without club stop-words."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = "".join(c if c.isalnum() else " " for c in s)
    toks = s.split()
    if stop:
        toks = [t for t in toks if t not in STOP] or toks
    return " ".join(toks)


def name_score(a: str | None, b: str | None, stop: bool = False) -> float:
    a, b = norm(a, stop), norm(b, stop)
    if not a or not b:
        return 0.0
    return max(fuzz.token_sort_ratio(a, b), fuzz.partial_ratio(a, b) * 0.95,
               fuzz.token_set_ratio(a, b) * 0.95)  # fmt: skip


# ---- clubs -----------------------------------------------------------------------------------


def map_clubs(src: pd.DataFrame, tm: pd.DataFrame) -> pd.DataFrame:
    """``src`` and ``tm``: matches with (match_id, competition_id, match_date, home_id,
    away_id, home_name, away_name). Returns one row per source club with its TM club."""
    tm = tm.copy()
    tm["match_date"] = pd.to_datetime(tm.match_date)
    by_day = defaultdict(list)
    for r in tm.itertuples(index=False):
        for d in (-1, 0, 1):
            by_day[(r.competition_id, r.match_date + pd.Timedelta(days=d))].append(r)
    votes: dict[int, Counter] = defaultdict(Counter)
    names: dict[int, str] = {}
    tm_names: dict[int, str] = {}
    for r in src.itertuples(index=False):
        names[r.home_id], names[r.away_id] = r.home_name, r.away_name
        cands = by_day.get((r.competition_id, pd.Timestamp(r.match_date)), [])
        # among same-day TM matches, the one whose clubs' names fit best
        best, best_s = None, -1.0
        for c in cands:
            s = (name_score(r.home_name, c.home_name, True)
                 + name_score(r.away_name, c.away_name, True))  # fmt: skip
            if s > best_s:
                best, best_s = c, s
        if best is not None:
            votes[r.home_id][best.home_id] += 1
            votes[r.away_id][best.away_id] += 1
            tm_names[best.home_id], tm_names[best.away_id] = best.home_name, best.away_name
    rows = []
    for club, v in votes.items():
        tm_id, n = v.most_common(1)[0]
        share = n / sum(v.values())
        s = name_score(names[club], tm_names.get(tm_id), True)
        rows.append({"source_id": club, "source_name": names[club], "canonical_id": f"tm-{tm_id}",
                     "tm_name": tm_names.get(tm_id), "votes": n, "share": share,
                     "name_score": s, "method": "fixtures",
                     "confidence": share * min(1.0, 0.5 + s / 200)})  # fmt: skip
    return pd.DataFrame(rows)


# ---- players ---------------------------------------------------------------------------------


def _name_matrix(src_names: list[list[str]], tm_names: list[str]) -> np.ndarray:
    """Best name score of each source player (several name variants) against each TM name,
    vectorised with rapidfuzz."""
    choices = [norm(n) for n in tm_names]
    best = np.zeros((len(src_names), len(choices)))
    width = max((len(v) for v in src_names), default=0)
    for k in range(width):
        q = [norm(v[k]) if k < len(v) and v[k] else "" for v in src_names]
        for scorer, w in ((fuzz.token_sort_ratio, 1.0), (fuzz.token_set_ratio, 0.95)):
            m = process.cdist(q, choices, scorer=scorer, workers=-1) * w
            m[[i for i, x in enumerate(q) if not x], :] = 0
            best = np.maximum(best, m)
    return best


def map_players(src_lu: pd.DataFrame, tm_lu: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Assign source players to TM players within each (canonical match, canonical club),
    then vote across matches. ``src_lu``: canonical_match, canonical_club, player_id, names
    (list), shirt, dob. ``tm_lu``: canonical_match, canonical_club, player_id, name, shirt,
    dob. Name and date-of-birth scores are computed once per club (the same pairs recur in
    every match); the shirt-number bonus is per match. Returns (mapping, qa)."""
    tm_lu = tm_lu[tm_lu.canonical_match.isin(set(src_lu.canonical_match))]
    votes: dict[int, Counter] = defaultdict(Counter)
    scores: dict[tuple[int, int], list[float]] = defaultdict(list)
    for club, sg in src_lu.groupby("canonical_club"):
        tg = tm_lu[tm_lu.canonical_club == club]
        if tg.empty:
            continue
        sp = sg.drop_duplicates("player_id")
        tp = tg.drop_duplicates("player_id")
        base = _name_matrix([list(x) for x in sp.names], tp.name.fillna("").tolist())
        # dates of birth: equal +25; a typo (within ~13 months, e.g. a day or month off)
        # -5; further apart is a different person: hard veto
        sdob = pd.to_datetime(sp.dob).to_numpy(dtype="datetime64[D]")
        tdob = pd.to_datetime(tp.dob).to_numpy(dtype="datetime64[D]")
        have = pd.notna(sp.dob).to_numpy()[:, None] & pd.notna(tp.dob).to_numpy()[None, :]
        gap = np.abs((sdob[:, None] - tdob[None, :]).astype("float64"))
        same = have & (gap == 0)
        base += np.where(have, np.where(gap == 0, 25.0, np.where(gap <= 400, -5.0, -100.0)), 0)
        si = {pid: i for i, pid in enumerate(sp.player_id)}
        ti = {pid: j for j, pid in enumerate(tp.player_id)}
        tm_by_match = {k: g for k, g in tg.groupby("canonical_match")}
        for mid, g in sg.groupby("canonical_match"):
            t = tm_by_match.get(mid)
            if t is None:
                continue
            rows = [si[x] for x in g.player_id]
            cols = [ti[x] for x in t.player_id]
            m = base[np.ix_(rows, cols)].copy()
            gs, ts = g.shirt.to_numpy(dtype=float), t.shirt.to_numpy(dtype=float)
            shirt = gs[:, None] == ts[None, :]
            m += np.where(shirt, 10.0, 0.0)
            ri, ci = linear_sum_assignment(-m)
            good = [(i, j) for i, j in zip(ri, ci, strict=True) if m[i, j] >= PLAYER_MIN_SCORE]
            # residual pairing: one player left on each side whose shirt or date of birth
            # agrees (known-as names such as "Chicharito" for Javier Hernández)
            left_i = set(range(len(rows))) - {i for i, _ in good}
            left_j = set(range(len(cols))) - {j for _, j in good}
            for i in sorted(left_i):  # identical date of birth in the same team-match
                hit = [j for j in left_j if same[rows[i], cols[j]]]
                if len(hit) == 1:
                    good.append((i, hit[0]))
                    left_j.discard(hit[0])
            left_i -= {i for i, _ in good}
            if len(left_i) == 1 and len(left_j) == 1:
                i, j = left_i.pop(), left_j.pop()
                if (shirt[i, j] and base[rows[i], cols[j]] > -50) or same[rows[i], cols[j]]:
                    good.append((i, j))
            for i, j in good:
                a, b = int(g.player_id.iloc[i]), int(t.player_id.iloc[j])
                votes[a][b] += 1
                scores[(a, b)].append(m[i, j])
    rows, qa = [], []
    seen = set(src_lu.player_id.astype(int))
    for sp_id, v in votes.items():
        (tp_id, n), *_ = v.most_common()
        total = sum(v.values())
        share = n / total
        mean = float(np.mean(scores[(sp_id, tp_id)]))
        ok = share >= 0.8 and (n >= 3 or n == total)
        rows.append({"source_id": sp_id, "canonical_id": f"tm-{tp_id}" if ok else None,
                     "votes": n, "share": share, "mean_score": mean,
                     "method": "lineups" if ok else "ambiguous",
                     "confidence": share * min(1.0, mean / 100)})  # fmt: skip
        if not ok:
            qa.append({"source_id": sp_id, "reason": "ambiguous votes",
                       "candidates": str(v.most_common(3))})  # fmt: skip
    for sp_id in seen - set(votes):
        qa.append({"source_id": sp_id, "reason": "no candidate above threshold",
                   "candidates": ""})  # fmt: skip
    return pd.DataFrame(rows), pd.DataFrame(qa)


# ---- build -----------------------------------------------------------------------------------


def _tm_matches(con, comps: tuple[str, ...], seasons: tuple[int, ...]) -> pd.DataFrame:
    return con.execute(f"""
        select game_id match_id, competition_id, match_date, home_club_id home_id,
               away_club_id away_id, home_club_name home_name, away_club_name away_name
        from stg.tm_games where competition_id in {comps} and season in {seasons}
        """).df()  # fmt: skip


def _overrides() -> pd.DataFrame:
    p = OVERRIDES / "crosswalk_overrides.csv"
    if not p.exists():
        return pd.DataFrame(columns=["entity", "source", "source_id", "canonical_id", "note"])
    return pd.read_csv(p, dtype=str)


def build(con, paths: Paths) -> dict[str, int]:
    clubs, matches, players, qa = [], [], [], []
    sources = []
    if has_table(con, "stg", "wy_matches"):
        sources.append(("wyscout", con.execute("""
            select m.match_id, m.competition_id, m.kickoff_utc::date match_date,
                   m.home_team_id home_id, m.away_team_id away_id, h.name home_name,
                   a.name away_name, m.season
            from stg.wy_matches m join stg.wy_teams h on h.team_id = m.home_team_id
            join stg.wy_teams a on a.team_id = m.away_team_id""").df()))  # fmt: skip
    if has_table(con, "stg", "sb_matches"):
        sources.append(("statsbomb", con.execute("""
            select match_id, competition_id, match_date, home_team_id home_id,
                   away_team_id away_id, home_team_name home_name, away_team_name away_name,
                   season
            from stg.sb_matches""").df()))  # fmt: skip
    tm_comps = ("GB1", "ES1", "L1", "IT1", "FR1")
    for source, sm in sources:
        men = sm[sm.competition_id.isin(tm_comps)]
        women = sm[~sm.competition_id.isin(tm_comps)]
        if len(men):
            tm = _tm_matches(con, tm_comps, tuple(int(s) for s in men.season.unique()) + (-1,))
            c = map_clubs(men, tm).assign(source=source)
            clubs.append(c)
            cmap = dict(zip(c.source_id, c.canonical_id, strict=True))
            tmm = tm.assign(match_date=pd.to_datetime(tm.match_date))
            key = {(f"tm-{r.home_id}", f"tm-{r.away_id}", r.match_date + pd.Timedelta(days=d)):
                   r.match_id for r in tmm.itertuples(index=False) for d in (-1, 0, 1)}  # fmt: skip
            for r in men.itertuples(index=False):
                g = key.get((cmap.get(r.home_id), cmap.get(r.away_id),
                             pd.Timestamp(r.match_date)))  # fmt: skip
                matches.append({"source": source, "source_id": r.match_id,
                                "canonical_id": f"tm-{g}" if g else None,
                                "method": "clubs+date" if g else "unmatched"})  # fmt: skip
        for side in ("home", "away"):  # women's clubs: own canonical ids
            for cid, name in women[[f"{side}_id", f"{side}_name"]].drop_duplicates().values:
                clubs.append(pd.DataFrame([{
                    "source": source, "source_id": cid, "source_name": name,
                    "canonical_id": f"{source[:2]}-{cid}", "method": "own", "confidence": 1.0,
                }]))  # fmt: skip
        for r in women.itertuples(index=False):
            matches.append(
                {
                    "source": source,
                    "source_id": r.match_id,
                    "canonical_id": f"{source[:2]}m-{r.match_id}",
                    "method": "own",
                }
            )
    clubs_df = pd.concat(clubs, ignore_index=True).drop_duplicates(["source", "source_id"])
    matches_df = pd.DataFrame(matches)

    # players: lineups within matched matches
    tm_lu = con.execute("""
        select 'tm-' || l.game_id canonical_match, 'tm-' || l.club_id canonical_club,
               l.player_id, p.name, l.shirt, p.date_of_birth dob
        from stg.tm_lineups l join stg.tm_players p using (player_id)""").df()  # fmt: skip
    for source, prefix in (("wyscout", "wy"), ("statsbomb", "sb")):
        if not has_table(con, "stg", f"{prefix}_lineups"):
            continue
        if source == "wyscout":
            lu = con.execute("""
                select l.match_id, l.team_id, l.player_id,
                       [p.short_name, p.first_name || ' ' || p.last_name, p.last_name] names,
                       null::int shirt, p.birth_date dob
                from stg.wy_lineups l join stg.wy_players p using (player_id)""").df()
        else:
            lu = con.execute("""
                select distinct match_id, team_id, player_id, [player_name, nickname] names,
                       jersey shirt, null::date dob
                from stg.sb_lineups""").df()  # fmt: skip
        mm = matches_df[matches_df.source == source].set_index("source_id").canonical_id
        cm = clubs_df[clubs_df.source == source].set_index("source_id").canonical_id
        lu["canonical_match"] = lu.match_id.map(mm)
        lu["canonical_club"] = lu.team_id.map(cm)
        tm_side = lu[lu.canonical_match.str.startswith("tm-", na=False)]
        own = lu[~lu.canonical_match.str.startswith("tm-", na=False)]
        mp, pqa = map_players(tm_side.drop_duplicates(["match_id", "player_id"]), tm_lu)
        players.append(mp.assign(source=source))
        if len(pqa):
            qa.append(pqa.assign(entity="player", source=source))
        for pid in own.player_id.unique():
            players.append(pd.DataFrame([{"source": source, "source_id": pid,
                                          "canonical_id": f"{prefix}-{pid}", "method": "own",
                                          "confidence": 1.0}]))  # fmt: skip
    players_df = pd.concat(players, ignore_index=True)
    players_df = players_df.drop_duplicates(["source", "source_id"])
    # unmatched players (no TM match) keep their own id; flagged in QA above
    players_df["canonical_id"] = players_df.canonical_id.fillna(
        players_df.source.str[:2] + "-" + players_df.source_id.astype(str)
    )

    # overrides win
    ov = _overrides()
    xw = pd.concat([clubs_df.assign(entity="club"), matches_df.assign(entity="match"),
                    players_df.assign(entity="player")], ignore_index=True)  # fmt: skip
    xw["source_id"] = xw.source_id.astype(str)
    for r in ov.itertuples(index=False):
        sel = (xw.entity == r.entity) & (xw.source == r.source) & (xw.source_id == r.source_id)
        xw.loc[sel, ["canonical_id", "method", "confidence"]] = [r.canonical_id, "override", 1.0]
    qa_df = pd.concat(qa, ignore_index=True) if qa else pd.DataFrame(
        columns=["source_id", "reason", "candidates", "entity", "source"])  # fmt: skip
    low = xw[(xw.entity == "club") & (xw.method == "fixtures")
             & ((xw.share < CLUB_VOTE_SHARE) | (xw.name_score < 50))]  # fmt: skip
    qa_df = pd.concat([qa_df, low.assign(reason="club vote share or name score low")[
        ["entity", "source", "source_id", "reason"]]], ignore_index=True)  # fmt: skip
    if has_table(con, "stg", "wy_players"):
        wp = con.execute("select player_id, birth_date from stg.wy_players").df()
        tp = con.execute("select player_id, date_of_birth from stg.tm_players").df()
        x = xw[
            (xw.entity == "player")
            & (xw.source == "wyscout")
            & xw.canonical_id.str.startswith("tm-", na=False)
        ].copy()
        x["tm_id"] = x.canonical_id.str[3:].astype("int64")
        x["wy_id"] = x.source_id.astype("int64")
        x = x.merge(wp, left_on="wy_id", right_on="player_id").merge(
            tp, left_on="tm_id", right_on="player_id", suffixes=("", "_tm")
        )
        bad = x[x.birth_date.notna() & x.date_of_birth.notna()
                & (pd.to_datetime(x.birth_date).dt.date
                   != pd.to_datetime(x.date_of_birth).dt.date)]  # fmt: skip
        qa_df = pd.concat(
            [
                qa_df,
                bad.assign(
                    entity="player",
                    reason="matched by name/lineups but date of birth disagrees",
                    candidates=bad.birth_date.astype(str) + " vs " + bad.date_of_birth.astype(str),
                )[["entity", "source", "source_id", "reason", "candidates"]],
            ],
            ignore_index=True,
        )
    unm = xw[(xw.entity == "match") & xw.canonical_id.isna()]
    qa_df = pd.concat([qa_df, unm.assign(reason="no TM match on date ±1 with both clubs")[
        ["entity", "source", "source_id", "reason"]]], ignore_index=True)  # fmt: skip
    keep = ["entity", "source", "source_id", "canonical_id", "method", "confidence"]
    con.register("xw_df", xw[keep + [c for c in ("votes", "share", "name_score")
                                     if c in xw.columns]])  # fmt: skip
    con.register("qa_df", qa_df.astype({"source_id": str}))
    n = {"crosswalk": materialize(con, paths, "core", "crosswalk", "select * from xw_df"),
         "crosswalk_qa": materialize(con, paths, "core", "crosswalk_qa",
                                     "select * from qa_df")}  # fmt: skip
    con.unregister("xw_df")
    con.unregister("qa_df")
    return n
