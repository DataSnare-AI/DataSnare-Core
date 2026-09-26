from __future__ import annotations

from typing import Protocol

from app.contracts.knowledge_graph import KnowledgeEdge


class KnowledgeGraphRepository(Protocol):
    async def add_edge(self, edge: KnowledgeEdge) -> KnowledgeEdge: ...

    async def list_edges(self, tenant_id: int) -> list[KnowledgeEdge]: ...


class InMemoryKnowledgeGraphRepository:
    def __init__(self):
        self._edges: dict[tuple[int, str], KnowledgeEdge] = {}

    async def add_edge(self, edge: KnowledgeEdge) -> KnowledgeEdge:
        self._edges[(edge.tenant_id, edge.edge_id)] = edge
        return edge

    async def list_edges(self, tenant_id: int) -> list[KnowledgeEdge]:
        return [edge for (edge_tenant_id, _), edge in self._edges.items() if edge_tenant_id == tenant_id]
