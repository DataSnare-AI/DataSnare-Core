from __future__ import annotations

import json
from typing import Any

from app.contracts.agent_manifest import AgentManifest


class PostgresAgentManifestRepository:
    """Tenant-scoped PostgreSQL adapter for agent manifests."""

    def __init__(self, db):
        self.db = db

    async def upsert(self, manifest: AgentManifest) -> AgentManifest:
        await self.db.execute(
            """
            INSERT INTO rag_agent_manifests (
                tenant_id, agent_id, system_name, site_id, area_id, capabilities,
                knowledge_types, status, last_seen_at, metadata, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb, NOW())
            ON CONFLICT (tenant_id, agent_id) DO UPDATE SET
                system_name = EXCLUDED.system_name,
                site_id = EXCLUDED.site_id,
                area_id = EXCLUDED.area_id,
                capabilities = EXCLUDED.capabilities,
                knowledge_types = EXCLUDED.knowledge_types,
                status = EXCLUDED.status,
                last_seen_at = EXCLUDED.last_seen_at,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            """,
            manifest.tenant_id,
            manifest.agent_id,
            manifest.system_name,
            manifest.site_id,
            manifest.area_id,
            _json(manifest.capabilities),
            _json(manifest.knowledge_types),
            manifest.status,
            manifest.last_seen_at,
            _json(manifest.metadata),
        )
        return manifest

    async def list_for_tenant(self, tenant_id: int) -> list[AgentManifest]:
        rows = await self.db.fetch(
            """
            SELECT tenant_id, agent_id, system_name, site_id, area_id, capabilities,
                   knowledge_types, status, last_seen_at, metadata
            FROM rag_agent_manifests
            WHERE tenant_id = $1
            ORDER BY agent_id
            """,
            tenant_id,
        )
        return [_manifest_from_row(row) for row in rows]

    async def get(self, tenant_id: int, agent_id: str) -> AgentManifest | None:
        row = await self.db.fetchrow(
            """
            SELECT tenant_id, agent_id, system_name, site_id, area_id, capabilities,
                   knowledge_types, status, last_seen_at, metadata
            FROM rag_agent_manifests
            WHERE tenant_id = $1 AND agent_id = $2
            """,
            tenant_id,
            agent_id,
        )
        return _manifest_from_row(row) if row is not None else None


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _manifest_from_row(row: Any) -> AgentManifest:
    return AgentManifest(
        tenant_id=row["tenant_id"],
        agent_id=row["agent_id"],
        system_name=row["system_name"],
        site_id=row.get("site_id"),
        area_id=row.get("area_id"),
        capabilities=list(row.get("capabilities") or []),
        knowledge_types=list(row.get("knowledge_types") or []),
        status=row["status"],
        last_seen_at=row.get("last_seen_at"),
        metadata=dict(row.get("metadata") or {}),
    )
