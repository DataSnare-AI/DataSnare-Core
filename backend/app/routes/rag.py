from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Header

from app.contracts.knowledge import RagRetrieveRequest, RagRetrievalResponse
from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/rag", tags=["RAG"])


@router.post("/retrieve", response_model=RagRetrievalResponse)
async def retrieve_knowledge(
    tenant_id: int,
    body: RagRetrieveRequest,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.retrieve")
    retrieval_id = f"retrieval_{uuid4().hex}"
    return RagRetrievalResponse(
        retrieval_id=retrieval_id,
        tenant_id=tenant_id,
        actor_id=actor.actor_id,
        status="not_indexed",
        query=body.query,
        audit_event={
            "schema": "datasnare-rag/retrieval-audit-v1",
            "event_type": "rag.retrieve",
            "retrieval_id": retrieval_id,
            "tenant_id": tenant_id,
            "actor_id": actor.actor_id,
            "role": actor.role,
            "status": "not_indexed",
        },
    )
