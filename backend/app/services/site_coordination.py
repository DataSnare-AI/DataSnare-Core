from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class SiteQueryPlan:
    tenant_id: int
    site_id: str
    query: str
    area_ids: tuple[str, ...]
    agent_ids: tuple[str, ...]
    top_k: int
    cache_key: str


def build_site_query_plan(
    tenant_id: int,
    site_id: str,
    query: str,
    *,
    area_ids: tuple[str, ...] = (),
    agent_ids: tuple[str, ...] = (),
    top_k: int = 10,
) -> SiteQueryPlan:
    normalized = {
        "tenant_id": tenant_id,
        "site_id": site_id.strip(),
        "query": query.strip(),
        "area_ids": sorted(set(area_ids)),
        "agent_ids": sorted(set(agent_ids)),
        "top_k": top_k,
    }
    cache_key = "site:" + hashlib.sha256(json.dumps(normalized, sort_keys=True).encode("utf-8")).hexdigest()
    return SiteQueryPlan(
        tenant_id=tenant_id,
        site_id=normalized["site_id"],
        query=normalized["query"],
        area_ids=tuple(normalized["area_ids"]),
        agent_ids=tuple(normalized["agent_ids"]),
        top_k=top_k,
        cache_key=cache_key,
    )
