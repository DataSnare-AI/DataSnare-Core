from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Header, Request

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance, RagRetrieveRequest, RagRetrievalResponse
from app.repositories.retrieval_audit import RetrievalAuditEvent
from app.security.authorization import require_permission, resolve_actor
from app.services.routing import route_query
from app.services.site_coordination import build_site_query_plan
from app.services.site_results import SiteResult, aggregate_site_results


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
    await request.app.state.retrieval_audit.append(RetrievalAuditEvent(
        tenant_id=tenant_id,
        actor_id=actor.actor_id,
        retrieval_id=retrieval_id,
        status=retrieval_status,
        routed_agent_ids=tuple(routed_agent_ids or ()),
        metadata={"query": body.query, "result_count": len(results), "routing_reason": route.reason},
    ))
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


@router.get("/audit")
async def list_retrieval_audit(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.audit.view")
    events = await request.app.state.retrieval_audit.list_for_tenant(tenant_id)
    return {
        "schema": "datasnare-rag/retrieval-audit-list-v1",
        "tenant_id": tenant_id,
        "events": [
            {
                "event_id": event.event_id,
                "retrieval_id": event.retrieval_id,
                "actor_id": event.actor_id,
                "status": event.status,
                "routed_agent_ids": list(event.routed_agent_ids),
                "metadata": event.metadata,
                "created_at": event.created_at.isoformat(),
            }
            for event in events
        ],
    }


@router.post("/site/retrieve", response_model=RagRetrievalResponse)
async def retrieve_site_knowledge(
    tenant_id: int,
    body: RagRetrieveRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.retrieve")
    if not body.site_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="site_id is required for site retrieval")
    plan = build_site_query_plan(tenant_id, body.site_id, body.query, area_ids=(body.area_id,) if body.area_id else (), agent_ids=(body.agent_id,) if body.agent_id else (), top_k=body.top_k)
    cached = await request.app.state.site_cache.get(tenant_id, plan.cache_key)
    if cached:
        return RagRetrievalResponse.model_validate(cached)
    manifests = await request.app.state.agent_manifests.list_for_tenant(tenant_id)
    route = route_query(manifests, site_id=plan.site_id, area_id=body.area_id, agent_id=body.agent_id, item_types=body.item_types)
    routed_agent_ids = route.agent_ids if manifests else None
    query_embedding = request.app.state.embedding_provider.embed(body.query)
    documents = await request.app.state.vector_store.search(tenant_id, query_embedding.vector, body.top_k, routed_agent_ids)
    site_results = aggregate_site_results([
        SiteResult(
            item_id=document.metadata.get("knowledge_item_id", document.item_id),
            text=document.text,
            score=1.0,
            area_ids=(document.metadata.get("area_id"),) if document.metadata.get("area_id") else (),
            agent_ids=(document.metadata.get("agent_id"),) if document.metadata.get("agent_id") else (),
            metadata=document.metadata,
        ) for document in documents
    ], body.top_k)
    results = [KnowledgeItem(
        tenant_id=tenant_id,
        item_id=result.item_id,
        item_type="document",
        title=result.metadata.get("title"),
        text=result.text,
        metadata=result.metadata,
        provenance=KnowledgeProvenance(source_type=result.metadata.get("source_type", "document"), source_id=result.metadata.get("source_id", result.item_id), source_name=result.metadata.get("source_name"), agent_id=result.metadata.get("agent_id"), site_id=result.metadata.get("site_id"), area_id=result.metadata.get("area_id")),
    ) for result in site_results]
    retrieval_id = f"retrieval_{uuid4().hex}"
    status = "indexed" if results else "not_indexed"
    response = RagRetrievalResponse(retrieval_id=retrieval_id, tenant_id=tenant_id, actor_id=actor.actor_id, status=status, query=body.query, results=results, audit_event={"schema": "datasnare-rag/retrieval-audit-v1", "event_type": "rag.site_retrieve", "retrieval_id": retrieval_id, "tenant_id": tenant_id, "actor_id": actor.actor_id, "role": actor.role, "status": status, "site_id": plan.site_id, "routed_agent_ids": list(routed_agent_ids or []), "routing_reason": route.reason})
    await request.app.state.site_cache.set(tenant_id, plan.cache_key, response.model_dump(by_alias=True))
    return response
