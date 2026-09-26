from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class SiteResult:
    item_id: str
    text: str
    score: float
    area_ids: tuple[str, ...] = ()
    agent_ids: tuple[str, ...] = ()
    metadata: dict = field(default_factory=dict)


def aggregate_site_results(results: Iterable[SiteResult], top_k: int = 10) -> list[SiteResult]:
    """Merge duplicate evidence returned by multiple area coordinators."""
    merged: dict[str, SiteResult] = {}
    for result in results:
        current = merged.get(result.item_id)
        if current is None:
            merged[result.item_id] = result
            continue
        merged[result.item_id] = SiteResult(
            item_id=result.item_id,
            text=current.text if current.score >= result.score else result.text,
            score=max(current.score, result.score),
            area_ids=tuple(sorted(set(current.area_ids).union(result.area_ids))),
            agent_ids=tuple(sorted(set(current.agent_ids).union(result.agent_ids))),
            metadata={**current.metadata, **result.metadata},
        )
    return sorted(merged.values(), key=lambda result: result.score, reverse=True)[:top_k]
