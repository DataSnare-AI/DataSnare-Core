from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Header, Request

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance, RagRetrieveRequest, RagRetrievalResponse
from app.security.authorization import require_permission, resolve_actor
from app.services.routing import route_query


router = APIRouter(prefix="/api/tenants/{tenant_id}/rag", tags=["RAG"])


@router.post("/retrieve", response_model=RagRetrievalResponse)
async def retrieve_knowledge(
    tenant_id: int,
    body: RagRetrieveRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.retrieve")
    retrieval_id = f"retrieval_{uuid4().hex}"
    query_embedding = request.app.state.embedding_provider.embed(body.query)
    manifests = await request.app.state.agent_manifests.list_for_tenant(tenant_id)
    route = route_query(manifests, site_id=body.site_id, area_id=body.area_id, agent_id=body.agent_id, item_types=body.item_types)
    routed_agent_ids = route.agent_ids if manifests else None
    documents = await request.app.state.vector_store.search(tenant_id, query_embedding.vector, body.top_k, routed_agent_ids)
    results = [KnowledgeItem(
        tenant_id=tenant_id,
        item_id=document.metadata.get("knowledge_item_id", document.item_id),
        item_type="document",
        title=document.metadata.get("title"),
        text=document.text,
        metadata=document.metadata,
        provenance=KnowledgeProvenance(
            source_type=document.metadata.get("source_type", "document"),
            source_id=document.metadata.get("source_id", document.item_id),
            source_name=document.metadata.get("source_name"),
            agent_id=document.metadata.get("agent_id"),
            site_id=document.metadata.get("site_id"),
            area_id=document.metadata.get("area_id"),
        ),
    ) for document in documents]
    retrieval_status = "indexed" if results else "not_indexed"
    return RagRetrievalResponse(
        retrieval_id=retrieval_id,
        tenant_id=tenant_id,
        actor_id=actor.actor_id,
        status=retrieval_status,
        query=body.query,
        results=results,
        audit_event={
            "schema": "datasnare-rag/retrieval-audit-v1",
            "event_type": "rag.retrieve",
            "retrieval_id": retrieval_id,
            "tenant_id": tenant_id,
            "actor_id": actor.actor_id,
            "role": actor.role,
            "status": retrieval_status,
            "routed_agent_ids": list(routed_agent_ids or []),
            "routing_reason": route.reason,
        },
    )
