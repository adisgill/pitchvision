"""Stint reconstruction on a hand-built match (spec 5.5 rules)."""

import pandas as pd

from pitchvision.metrics.stints import reconstruct

H, A = 1, 2
HOME = list(range(100, 111))
AWAY = list(range(200, 211))


def _match(events):
    games = pd.DataFrame([{"game_id": 9, "competition_id": "GB1", "season": 2024,
                           "home_club_id": H, "away_club_id": A, "home_goals": 0,
                           "away_goals": 0}])  # fmt: skip
    starters = pd.DataFrame(
        [{"game_id": 9, "club_id": H, "player_id": p} for p in HOME]
        + [{"game_id": 9, "club_id": A, "player_id": p} for p in AWAY]
    )
    cols = ["game_id", "club_id", "minute", "type", "player_id", "player_in_id", "card",
            "is_penalty", "is_own_goal"]  # fmt: skip
    ev = pd.DataFrame([dict(zip(cols, [9, *e], strict=True)) for e in events], columns=cols)
    return reconstruct(games, starters, ev)


def goal(club, minute, scorer, pen=False, og=False):
    return [club, minute, "goals", scorer, None, None, pen, og]


def sub(club, minute, out, inn):
    return [club, minute, "substitutions", out, inn, None, False, False]


def red(club, minute, player):
    return [club, minute, "cards", player, None, "red", False, False]


def test_no_events_is_one_full_stint():
    st, pm = _match([])
    assert len(st) == 1 and st.minutes.iloc[0] == 90
    assert pm.minutes.eq(90).all() and len(pm) == 22


def test_goal_in_sub_minute_counts_before_the_sub():
    st, _ = _match([sub(H, 60, 100, 111), goal(H, 60, 105)])
    assert st.home_goals.tolist() == [1, 0]  # credited to the stint before the change
    assert 100 in st.home_players.iloc[0] and 111 in st.home_players.iloc[1]


def test_goal_by_incoming_player_in_sub_minute_counts_after():
    st, _ = _match([sub(H, 60, 100, 111), goal(H, 60, 111)])
    assert st.home_goals.tolist() == [0, 1]


def test_red_card_shrinks_side_and_splits_stint():
    st, pm = _match([red(A, 30, 200)])
    assert st.minutes.tolist() == [30, 60]
    assert [len(x) for x in st.away_players] == [11, 10]
    assert pm.set_index("player_id").minutes[200] == 30


def test_ninetieth_minute_sub_gets_zero_minutes_and_goals_still_reconcile():
    st, pm = _match([goal(A, 90, 205), sub(H, 90, 100, 111)])
    assert st.minutes.sum() == 90 and st.away_goals.sum() == 1
    assert 111 not in set(pm.player_id)


def test_penalty_and_own_goal_crediting():
    # TM credits an own goal to the benefiting club, so club_id A here means A scores
    st, _ = _match([goal(H, 10, 105, pen=True), goal(A, 20, 103, og=True)])
    assert st.home_goals.sum() == 1 and st.home_np_goals.sum() == 0
    assert st.away_goals.sum() == 1 and st.away_np_goals.sum() == 1


def test_extra_time_length():
    st, pm = _match([goal(H, 105, 105)])
    assert st.length.iloc[0] == 120 and pm.minutes.max() == 120


def test_unknown_minute_marks_incomplete():
    st, _ = _match([sub(H, None, 100, 111)])
    assert not st.complete.iloc[0]
