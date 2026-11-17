import pandas as pd

from pitchvision.research.tactics import family, norm_formation, norm_name, number_spells


def test_formation_labels():
    assert norm_formation("4-3-3 Attacking") == "4-3-3"
    assert norm_formation("4-4-2 double 6") == "4-4-2"
    assert norm_formation("3-4-2-1") == "3-4-2-1"
    assert norm_formation(None) is None
    assert family("3-5-2") == "Back three"
    assert family("5-4-1") == "Back three"
    assert family("4-2-3-1") == "Back four"
    assert family(None) is None


def test_manager_names_match_across_spellings():
    s = pd.Series(
        ["Jürgen Klopp", "Ole Gunnar Solskjær", "Ole Gunnar Solskjaer", "José Bordalás", None]
    )
    out = norm_name(s)
    assert list(out[:4]) == [
        "jurgen klopp",
        "ole gunnar solskjaer",
        "ole gunnar solskjaer",
        "jose bordalas",
    ]
    assert pd.isna(out[4])


def test_caretaker_run_does_not_split_a_spell():
    mgrs = ["a"] * 4 + ["b"] * 2 + ["a"] * 3 + ["c"] * 5
    d = pd.DataFrame({"club_id": "x", "manager_key": mgrs})
    sp = number_spells(d).spell.tolist()
    assert sp[:4] == [1] * 4 and sp[6:9] == [1] * 3  # a's spell resumes
    assert sp[4:6] == [2, 2]  # the caretaker
    assert sp[9:] == [3] * 5  # a new manager
