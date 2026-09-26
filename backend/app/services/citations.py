from __future__ import annotations

from typing import Any, Iterable


def build_citations(results: Iterable[Any]) -> list[dict[str, Any]]:
    citations = []
    for result in results:
        provenance = result.provenance
        citations.append({
            "item_id": result.item_id,
            "source_type": provenance.source_type,
            "source_id": provenance.source_id,
            "source_name": provenance.source_name,
            "agent_id": provenance.agent_id,
            "site_id": provenance.site_id,
            "area_id": provenance.area_id,
            "chunk_index": result.metadata.get("chunk_index"),
            "start_offset": result.metadata.get("start_offset"),
            "end_offset": result.metadata.get("end_offset"),
        })
    return citations
