from __future__ import annotations

import json
from typing import Any

from app.repositories.retrieval_audit import RetrievalAuditEvent


class PostgresRetrievalAuditRepository:
    """Append-only tenant-scoped PostgreSQL adapter for retrieval audit events."""

    def __init__(self, db):
        self.db = db

    async def append(self, event: RetrievalAuditEvent) -> RetrievalAuditEvent:
        await self.db.execute(
            """
            INSERT INTO retrieval_audit_events (
                tenant_id, event_id, retrieval_id, actor_id, status,
                routed_agent_ids, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
            """,
            event.tenant_id,
            event.event_id,
            event.retrieval_id,
            event.actor_id,
            event.status,
            _json(event.routed_agent_ids),
            _json(event.metadata),
            event.created_at,
        )
        return event

    async def list_for_tenant(self, tenant_id: int) -> list[RetrievalAuditEvent]:
        rows = await self.db.fetch(
            """
            SELECT tenant_id, event_id, retrieval_id, actor_id, status,
                   routed_agent_ids, metadata, created_at
            FROM retrieval_audit_events
            WHERE tenant_id = $1
            ORDER BY created_at DESC, event_id
            """,
            tenant_id,
        )
        return [_event_from_row(row) for row in rows]


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _event_from_row(row: Any) -> RetrievalAuditEvent:
    return RetrievalAuditEvent(
        tenant_id=row["tenant_id"],
        event_id=row["event_id"],
        retrieval_id=row["retrieval_id"],
        actor_id=row["actor_id"],
        status=row["status"],
        routed_agent_ids=tuple(row.get("routed_agent_ids") or []),
        metadata=dict(row.get("metadata") or {}),
        created_at=row["created_at"],
    )
