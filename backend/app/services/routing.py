from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.contracts.agent_manifest import AgentManifest


@dataclass(frozen=True)
class RetrievalRoute:
    agent_ids: tuple[str, ...]
    reason: str


def route_query(
    manifests: Iterable[AgentManifest],
    *,
    site_id: str | None = None,
    area_id: str | None = None,
    agent_id: str | None = None,
    item_types: Iterable[str] = (),
) -> RetrievalRoute:
    requested_types = {item_type.strip().lower() for item_type in item_types if item_type.strip()}
    eligible = []
    for manifest in manifests:
        if manifest.status not in {"online", "degraded"}:
            continue
        if site_id and manifest.site_id != site_id:
            continue
        if area_id and manifest.area_id != area_id:
            continue
        if agent_id and manifest.agent_id != agent_id:
            continue
        if requested_types and not requested_types.intersection({value.lower() for value in manifest.knowledge_types}):
            continue
        eligible.append(manifest.agent_id)
    reason = "matched manifest filters" if eligible else "no eligible manifests"
    return RetrievalRoute(tuple(sorted(set(eligible))), reason)
