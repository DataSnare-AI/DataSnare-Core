from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.contracts.agent_manifest import AgentManifest, AgentManifestUpsertRequest
from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/rag/agents", tags=["RAG Agents"])


@router.put("/{agent_id}/manifest", response_model=AgentManifest)
async def upsert_agent_manifest(
    tenant_id: int,
    agent_id: str,
    body: AgentManifestUpsertRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.manifest.manage")
    manifest = AgentManifest(
        tenant_id=tenant_id,
        agent_id=agent_id,
        system_name=body.system_name,
        site_id=body.site_id,
        area_id=body.area_id,
        capabilities=body.capabilities,
        knowledge_types=body.knowledge_types,
        status=body.status,
        last_seen_at=body.last_seen_at,
        metadata={**body.metadata, "updated_by": actor.actor_id},
    )
    return await request.app.state.agent_manifests.upsert(manifest)


@router.get("", response_model=list[AgentManifest])
async def list_agent_manifests(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.retrieve")
    return await request.app.state.agent_manifests.list_for_tenant(tenant_id)
