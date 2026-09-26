from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable


@dataclass(frozen=True)
class RetrievalCandidate:
    tenant_id: int
    agent_id: str | None
    item_id: str
    text: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)


def aggregate_candidates(candidates: Iterable[RetrievalCandidate], top_k: int = 10) -> list[RetrievalCandidate]:
    """Deduplicate cross-agent evidence by item and retain the strongest candidate."""
    strongest: dict[str, RetrievalCandidate] = {}
    for candidate in candidates:
        current = strongest.get(candidate.item_id)
        if current is None or candidate.score > current.score:
            strongest[candidate.item_id] = candidate
    return sorted(strongest.values(), key=lambda candidate: candidate.score, reverse=True)[:top_k]


def rerank_candidates(query: str, candidates: Iterable[RetrievalCandidate], top_k: int = 10) -> list[RetrievalCandidate]:
    query_terms = set(re.findall(r"[a-z0-9_/-]+", query.lower()))
    scored = []
    for candidate in candidates:
        terms = set(re.findall(r"[a-z0-9_/-]+", candidate.text.lower()))
        overlap = len(query_terms.intersection(terms)) / max(1, len(query_terms))
        scored.append((candidate.score * 0.75 + overlap * 0.25, candidate))
    scored.sort(key=lambda entry: entry[0], reverse=True)
    return [candidate for _, candidate in scored[:top_k]]
