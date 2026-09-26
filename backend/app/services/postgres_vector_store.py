from __future__ import annotations

import json
from typing import Any, Sequence

from app.services.vector_store import VectorDocument


class PostgresVectorStore:
    """pgvector adapter for tenant-scoped chunk storage and cosine search."""

    def __init__(self, db):
        self.db = db

    async def upsert(self, document: VectorDocument) -> VectorDocument:
        await self.db.execute(
            """
            INSERT INTO knowledge_chunks (
                tenant_id, chunk_id, item_id, chunk_index, content,
                start_offset, end_offset, embedding_model, embedding, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10::jsonb)
            ON CONFLICT (tenant_id, chunk_id) DO UPDATE SET
                content = EXCLUDED.content,
                start_offset = EXCLUDED.start_offset,
                end_offset = EXCLUDED.end_offset,
                embedding_model = EXCLUDED.embedding_model,
                embedding = EXCLUDED.embedding,
                metadata = EXCLUDED.metadata
            """,
            document.tenant_id,
            document.item_id,
            document.metadata.get("knowledge_item_id", document.item_id),
            document.metadata.get("chunk_index", 0),
            document.text,
            document.metadata.get("start_offset", 0),
            document.metadata.get("end_offset", len(document.text)),
            document.metadata.get("embedding_model", "local-hash-v1"),
            _vector_literal(document.vector),
            json.dumps(document.metadata, separators=(",", ":")),
        )
        return document

    async def search(self, tenant_id: int, vector: Sequence[float], top_k: int = 10, agent_ids: Sequence[str] | None = None) -> list[VectorDocument]:
        filters = ""
        args: list[Any] = [tenant_id, _vector_literal(vector)]
        if agent_ids is not None:
            filters = " AND metadata->>'agent_id' = ANY($3::text[])"
            args.append(list(agent_ids))
        limit_index = len(args) + 1
        rows = await self.db.fetch(
            f"""
            SELECT tenant_id, chunk_id, content, embedding, metadata,
                   1 - (embedding <=> $2::vector) AS score
            FROM knowledge_chunks
            WHERE tenant_id = $1{filters}
            ORDER BY embedding <=> $2::vector
            LIMIT ${limit_index}
            """,
            *args,
            top_k,
        )
        return [VectorDocument(row["tenant_id"], row["chunk_id"], row["content"], tuple(), dict(row.get("metadata") or {})) for row in rows]


def _vector_literal(vector: Sequence[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in vector) + "]"
