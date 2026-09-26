from __future__ import annotations

from datetime import datetime
from typing import Any

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance


class PostgresKnowledgeItemRepository:
    """Postgres adapter for the knowledge-item protocol.

    The injected database object must provide asyncpg-like fetchrow and fetch methods.
    """

    def __init__(self, db):
        self.db = db

    async def create(self, item: KnowledgeItem) -> KnowledgeItem:
        await self.db.execute(
            """
            INSERT INTO knowledge_items (
                tenant_id, item_id, item_type, title, content, metadata,
                source_type, source_id, source_name, agent_id, site_id, area_id, observed_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (tenant_id, item_id) DO UPDATE SET
                item_type = EXCLUDED.item_type,
                title = EXCLUDED.title,
                content = EXCLUDED.content,
                metadata = EXCLUDED.metadata,
                source_type = EXCLUDED.source_type,
                source_id = EXCLUDED.source_id,
                source_name = EXCLUDED.source_name,
                agent_id = EXCLUDED.agent_id,
                site_id = EXCLUDED.site_id,
                area_id = EXCLUDED.area_id,
                observed_at = EXCLUDED.observed_at
            """,
            item.tenant_id, item.item_id, item.item_type, item.title, item.text,
            _json(item.metadata), item.provenance.source_type, item.provenance.source_id,
            item.provenance.source_name, item.provenance.agent_id, item.provenance.site_id,
            item.provenance.area_id, item.provenance.observed_at,
        )
        return item

    async def list_for_tenant(self, tenant_id: int) -> list[KnowledgeItem]:
        rows = await self.db.fetch(
            """
            SELECT tenant_id, item_id, item_type, title, content, metadata,
                   source_type, source_id, source_name, agent_id, site_id, area_id, observed_at
            FROM knowledge_items
            WHERE tenant_id = $1
            ORDER BY created_at DESC, item_id
            """,
            tenant_id,
        )
        return [_item_from_row(row) for row in rows]


def _json(value: dict[str, Any]) -> str:
    import json
    return json.dumps(value, separators=(",", ":"))


def _item_from_row(row: Any) -> KnowledgeItem:
    return KnowledgeItem(
        tenant_id=row["tenant_id"],
        item_id=row["item_id"],
        item_type=row["item_type"],
        title=row.get("title"),
        text=row["content"],
        metadata=dict(row.get("metadata") or {}),
        provenance=KnowledgeProvenance(
            source_type=row["source_type"], source_id=row["source_id"], source_name=row.get("source_name"),
            agent_id=row.get("agent_id"), site_id=row.get("site_id"), area_id=row.get("area_id"),
            observed_at=row.get("observed_at"),
        ),
    )
