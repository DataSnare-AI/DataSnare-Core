from __future__ import annotations

from collections import deque
from typing import Iterable

from app.contracts.knowledge_graph import KnowledgeEdge


GRAPH_ENTITY_TYPES = {
    "device", "user", "application", "service", "alert", "incident",
    "runbook", "document", "site", "knowledge_article", "change", "action",
}


def related_edges(
    edges: Iterable[KnowledgeEdge],
    *,
    entity_type: str,
    entity_id: str,
    predicate: str | None = None,
    max_hops: int = 1,
) -> list[KnowledgeEdge]:
    if entity_type not in GRAPH_ENTITY_TYPES or max_hops < 1:
        return []
    selected = []
    frontier = {(entity_type, entity_id)}
    visited = set(frontier)
    for _ in range(max_hops):
        next_frontier = set()
        for edge in edges:
            subject = (edge.subject_type, edge.subject_id)
            target = (edge.object_type, edge.object_id)
            if subject not in frontier and target not in frontier:
                continue
            if predicate and edge.predicate != predicate:
                continue
            if edge not in selected:
                selected.append(edge)
            for node in (subject, target):
                if node not in visited:
                    visited.add(node)
                    next_frontier.add(node)
        frontier = next_frontier
        if not frontier:
            break
    return selected
