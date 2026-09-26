from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException


ROLE_PERMISSIONS = {
    "viewer": {"ingest.jobs.view", "rag.retrieve"},
    "operator": {"ingest.jobs.view", "ingest.jobs.create", "ingest.jobs.cancel", "rag.retrieve", "rag.ingest"},
    "approver": {"ingest.jobs.view", "ingest.jobs.approve", "rag.retrieve"},
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


def resolve_actor(
    tenant_id: int,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
) -> ActorContext:
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
