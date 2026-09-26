import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.site_results import SiteResult, aggregate_site_results


def test_site_results_merge_duplicate_evidence_and_contributors():
    results = aggregate_site_results([
        SiteResult("item-1", "older text", .6, ("db",), ("agent-a",)),
        SiteResult("item-1", "stronger text", .9, ("web",), ("agent-b",)),
        SiteResult("item-2", "other evidence", .5, ("db",), ("agent-a",)),
    ])

    assert [result.item_id for result in results] == ["item-1", "item-2"]
    assert results[0].text == "stronger text"
    assert results[0].area_ids == ("db", "web")
    assert results[0].agent_ids == ("agent-a", "agent-b")