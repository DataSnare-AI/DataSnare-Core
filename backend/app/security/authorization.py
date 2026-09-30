from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from fastapi import Header, HTTPException, Request


ROLE_PERMISSIONS = {
    "viewer": {"ingest.jobs.view", "rag.retrieve"},
    "operator": {"ingest.jobs.view", "ingest.jobs.create", "ingest.jobs.cancel", "rag.retrieve", "rag.ingest", "rag.audit.view"},
    "approver": {"ingest.jobs.view", "ingest.jobs.approve", "rag.retrieve", "rag.audit.view"},
    "tenant_admin": {
        "ingest.jobs.view",
        "ingest.jobs.create",
        "ingest.jobs.cancel",
        "ingest.jobs.approve",
        "tenant.config.view",
        "tenant.config.edit",
        "rbac.view",
        "rbac.manage",
        "agent_credentials.view",
        "agent_credentials.create",
        "agent_credentials.revoke",
        "rag.retrieve",
        "rag.ingest",
        "rag.manifest.manage",
        "rag.audit.view",
        "rag.graph.manage",
    },
    "platform_admin": {"*"},
}


@dataclass(frozen=True)
class ActorContext:
    actor_id: str
    tenant_id: int
    role: str
    source: str = "development-header"

    def can(self, permission: str) -> bool:
        permissions = ROLE_PERMISSIONS.get(self.role, set())
        return "*" in permissions or permission in permissions


async def resolve_actor(
    tenant_id: int,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
    *,
    request: Request | None = None,
    authorization: str | None = None,
) -> ActorContext:
    provider = None
    if request is not None:
        provider = getattr(request.app.state, "auth_provider", None)
    if provider is not None:
        return await provider.resolve_actor(tenant_id, x_actor, x_role, request=request, authorization=authorization)

    if os.getenv("DATASNARE_ENV", "development").strip().lower() == "production":
        raise HTTPException(status_code=503, detail="Shared authentication provider is not configured")

    if request is not None and authorization is None:
        authorization = request.headers.get("authorization") or request.headers.get("Authorization")

    if authorization and not x_actor:
        token = authorization.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if token:
            return ActorContext(actor_id=token, tenant_id=tenant_id, role=(x_role or "operator").strip().lower() or "operator", source="authorization-header")

    actor = (x_actor or "").strip()
    if not actor:
        raise HTTPException(status_code=401, detail="DataSnare actor authentication is required")
    role = (x_role or "operator").strip().lower()
    if role not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=403, detail=f"Unsupported DataSnare actor role: {role}")
    return ActorContext(actor_id=actor, tenant_id=tenant_id, role=role)


def require_permission(context: ActorContext, permission: str) -> ActorContext:
    if not context.can(permission):
        raise HTTPException(
            status_code=403,
            detail=f"Actor '{context.actor_id}' does not have permission '{permission}' for tenant {context.tenant_id}",
        )
    return context
