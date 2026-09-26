from __future__ import annotations

from typing import Protocol

from app.contracts.knowledge_graph import KnowledgeEdge


class KnowledgeGraphRepository(Protocol):
    async def add_edge(self, edge: KnowledgeEdge) -> KnowledgeEdge: ...

    async def list_edges(self, tenant_id: int) -> list[KnowledgeEdge]: ...

    async def find_path(self, tenant_id: int, start_type: str, start_id: str, end_type: str, end_id: str, max_hops: int = 4) -> list[KnowledgeEdge]: ...


class InMemoryKnowledgeGraphRepository:
    def __init__(self):
        self._edges: dict[tuple[int, str], KnowledgeEdge] = {}

    async def add_edge(self, edge: KnowledgeEdge) -> KnowledgeEdge:
        self._edges[(edge.tenant_id, edge.edge_id)] = edge
        return edge

    async def list_edges(self, tenant_id: int) -> list[KnowledgeEdge]:
        return [edge for (edge_tenant_id, _), edge in self._edges.items() if edge_tenant_id == tenant_id]

    async def find_path(self, tenant_id: int, start_type: str, start_id: str, end_type: str, end_id: str, max_hops: int = 4) -> list[KnowledgeEdge]:
        if max_hops < 1:
            return []
        edges = await self.list_edges(tenant_id)
        frontier = [((start_type, start_id), [])]
        visited = {(start_type, start_id)}
        for _ in range(max_hops):
            next_frontier = []
            for node, path in frontier:
                for edge in edges:
                    if (edge.subject_type, edge.subject_id) != node:
                        continue
                    target = (edge.object_type, edge.object_id)
                    next_path = [*path, edge]
                    if target == (end_type, end_id):
                        return next_path
                    if target not in visited:
                        visited.add(target)
                        next_frontier.append((target, next_path))
            frontier = next_frontier
            if not frontier:
                break
        return []
