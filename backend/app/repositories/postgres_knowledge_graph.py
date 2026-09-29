from __future__ import annotations

import json
from typing import Any

from app.contracts.knowledge_graph import KnowledgeEdge
from app.repositories.knowledge_graph import InMemoryKnowledgeGraphRepository


class PostgresKnowledgeGraphRepository:
    """Tenant-scoped PostgreSQL adapter for graph edges."""

    def __init__(self, db):
        self.db = db

    async def add_edge(self, edge: KnowledgeEdge) -> KnowledgeEdge:
        await self.db.execute(
            """
            INSERT INTO knowledge_graph_edges (
                tenant_id, edge_id, subject_type, subject_id, predicate,
                object_type, object_id, observed_at, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
            ON CONFLICT (tenant_id, edge_id) DO UPDATE SET
                subject_type = EXCLUDED.subject_type,
                subject_id = EXCLUDED.subject_id,
                predicate = EXCLUDED.predicate,
                object_type = EXCLUDED.object_type,
                object_id = EXCLUDED.object_id,
                observed_at = EXCLUDED.observed_at,
                metadata = EXCLUDED.metadata
            """,
            edge.tenant_id,
            edge.edge_id,
            edge.subject_type,
            edge.subject_id,
            edge.predicate,
            edge.object_type,
            edge.object_id,
            edge.observed_at,
            _json(edge.metadata),
        )
        return edge

    async def list_edges(self, tenant_id: int) -> list[KnowledgeEdge]:
        rows = await self.db.fetch(
            """
            SELECT tenant_id, edge_id, subject_type, subject_id, predicate,
                   object_type, object_id, observed_at, metadata
            FROM knowledge_graph_edges
            WHERE tenant_id = $1
            ORDER BY observed_at, edge_id
            """,
            tenant_id,
        )
        return [_edge_from_row(row) for row in rows]

    async def find_path(
        self,
        tenant_id: int,
        start_type: str,
        start_id: str,
        end_type: str,
        end_id: str,
        max_hops: int = 4,
    ) -> list[KnowledgeEdge]:
        graph = InMemoryKnowledgeGraphRepository()
        for edge in await self.list_edges(tenant_id):
            await graph.add_edge(edge)
        return await graph.find_path(tenant_id, start_type, start_id, end_type, end_id, max_hops)


def _json(value: dict[str, Any]) -> str:
    return json.dumps(value, separators=(",", ":"))


def _edge_from_row(row: Any) -> KnowledgeEdge:
    return KnowledgeEdge(
        tenant_id=row["tenant_id"],
        edge_id=row["edge_id"],
        subject_type=row["subject_type"],
        subject_id=row["subject_id"],
        predicate=row["predicate"],
        object_type=row["object_type"],
        object_id=row["object_id"],
        observed_at=row["observed_at"],
        metadata=dict(row.get("metadata") or {}),
    )
