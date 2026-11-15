"""Identity crosswalk: name normalisation, fixture-voted clubs, lineup-assigned players."""

import pandas as pd

from pitchvision.core.crosswalk import map_clubs, map_players, name_score, norm


def test_norm_folds_accents_punctuation_and_club_tokens():
    assert norm("Atlético de Madrid") == "atletico de madrid"
    assert norm("Borussia M'gladbach", stop=True) == "borussia m gladbach"
    assert norm("FC Bayern München", stop=True) == "bayern munchen"
    assert norm(None) == ""


def test_name_score_handles_initials_and_order():
    assert name_score("L. Messi", "Lionel Messi") >= 80
    assert name_score("Messi Lionel", "Lionel Messi") == 100
    assert name_score("Harry Kane", "Kylian Mbappé") < 50


def _m(mid, comp, day, h, a, hn, an):
    return {"match_id": mid, "competition_id": comp, "match_date": pd.Timestamp(day),
            "home_id": h, "away_id": a, "home_name": hn, "away_name": an}  # fmt: skip


def test_clubs_are_mapped_by_fixtures_even_with_unlike_names():
    tm = pd.DataFrame(
        [
            _m(1, "GB1", "2017-08-12", 11, 985, "Chelsea FC", "Burnley FC"),
            _m(2, "GB1", "2017-08-12", 31, 1237, "Liverpool FC", "Brighton"),
            _m(3, "GB1", "2017-08-19", 985, 31, "Burnley FC", "Liverpool FC"),
        ]
    )
    src = pd.DataFrame([_m(10, "GB1", "2017-08-12", 1, 2, "Chelsea", "Burnley"),
                        _m(11, "GB1", "2017-08-13", 3, 4, "LFC", "Brighton & Hove Albion"),
                        _m(12, "GB1", "2017-08-19", 2, 3, "Burnley", "LFC")])  # fmt: skip
    c = map_clubs(src, tm).set_index("source_id")
    assert c.canonical_id[1] == "tm-11" and c.canonical_id[2] == "tm-985"
    assert c.canonical_id[3] == "tm-31"  # "LFC" resolved by its fixtures, date ±1 day
    assert c.share[3] == 1.0


def test_players_assigned_within_matches_with_dob_veto_and_residual_pairing():
    src = pd.DataFrame([
        {"canonical_match": "tm-1", "canonical_club": "tm-5", "player_id": 1,
         "names": ["L. Messi"], "shirt": 10, "dob": pd.Timestamp("1987-06-24")},
        {"canonical_match": "tm-1", "canonical_club": "tm-5", "player_id": 2,
         "names": ["J. Hernández"], "shirt": 14, "dob": pd.Timestamp("1988-06-01")},
        {"canonical_match": "tm-1", "canonical_club": "tm-5", "player_id": 3,
         "names": ["J. Williams"], "shirt": 30, "dob": pd.Timestamp("1999-10-22")},
    ])  # fmt: skip
    tm = pd.DataFrame([
        {"canonical_match": "tm-1", "canonical_club": "tm-5", "player_id": 28003,
         "name": "Lionel Messi", "shirt": 10, "dob": pd.Timestamp("1987-06-24")},
        {"canonical_match": "tm-1", "canonical_club": "tm-5", "player_id": 50935,
         "name": "Chicharito", "shirt": 14, "dob": pd.Timestamp("1988-06-01")},
        {"canonical_match": "tm-1", "canonical_club": "tm-5", "player_id": 77,
         "name": "Danny Williams", "shirt": 8, "dob": pd.Timestamp("1989-03-08")},
    ])  # fmt: skip
    mp, qa = map_players(src, tm)
    got = dict(zip(mp.source_id, mp.canonical_id, strict=True))
    assert got[1] == "tm-28003"
    assert got[2] == "tm-50935"  # known-as name: the residual pair, same date of birth
    assert 3 not in got or got[3] is None  # ten years apart: vetoed despite the name
    assert 3 in set(qa.source_id)
