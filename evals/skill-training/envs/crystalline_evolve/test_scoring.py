"""Reference-text tests for the reflect items of the evolve scorer."""

import json
from pathlib import Path

from envs.crystalline_evolve.scoring import describe_expectations

ITEMS = Path(__file__).resolve().parents[2] / "data/evolve_split/test/items.json"


def _expect(item_id: str) -> dict:
    for item in json.loads(ITEMS.read_text(encoding="utf-8")):
        if item["id"] == item_id:
            return item["expect"]
    raise KeyError(item_id)


def test_reflect_trigger_reads_as_one_story():
    text = describe_expectations(_expect("rf-trig-01"))
    assert "not an engram maintenance pass" in text
    assert "ordinary recall" not in text
    assert "scoped to domains ['lighthouse']" in text
    assert "reflect call" in text
