import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.retrieval import RetrievalCandidate, aggregate_candidates, rerank_candidates


def test_aggregate_candidates_deduplicates_by_item_and_keeps_strongest_score():
    candidates = [
        RetrievalCandidate(7, "agent-a", "item-1", "database restart", .4),
        RetrievalCandidate(7, "agent-b", "item-1", "database restart", .8),
        RetrievalCandidate(7, "agent-c", "item-2", "network timeout", .6),
    ]

    aggregated = aggregate_candidates(candidates)

    assert [candidate.item_id for candidate in aggregated] == ["item-1", "item-2"]
    assert aggregated[0].agent_id == "agent-b"


def test_rerank_candidates_rewards_query_term_overlap():
    candidates = [
        RetrievalCandidate(7, "agent-a", "item-1", "unrelated service note", .8),
        RetrievalCandidate(7, "agent-b", "item-2", "database restart procedure", .7),
    ]

    reranked = rerank_candidates("database restart", candidates)

    assert reranked[0].item_id == "item-2"