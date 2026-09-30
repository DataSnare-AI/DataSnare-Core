from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.contracts.knowledge_graph import KnowledgeEdge
from app.security.authorization import require_permission, resolve_actor
from app.services.graph_query import related_edges


router = APIRouter(prefix="/api/tenants/{tenant_id}/knowledge/graph", tags=["Knowledge Graph"])


@router.post("/edges", response_model=KnowledgeEdge, status_code=201)
async def add_edge(
    tenant_id: int,
    edge: KnowledgeEdge,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.graph.manage")
    saved = edge.model_copy(update={"tenant_id": tenant_id, "metadata": {**edge.metadata, "created_by": actor.actor_id}})
    return await request.app.state.knowledge_graph.add_edge(saved)


@router.get("/edges", response_model=list[KnowledgeEdge])
async def list_edges(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.retrieve")
    return await request.app.state.knowledge_graph.list_edges(tenant_id)


@router.get("/path")
async def find_path(
    tenant_id: int,
    start_type: str,
    start_id: str,
    end_type: str,
    end_id: str,
    request: Request,
    max_hops: int = 4,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.retrieve")
    path = await request.app.state.knowledge_graph.find_path(tenant_id, start_type, start_id, end_type, end_id, max_hops)
    return {
        "schema": "datasnare-knowledge/path-v1",
        "tenant_id": tenant_id,
        "start": {"type": start_type, "id": start_id},
        "end": {"type": end_type, "id": end_id},
        "hops": [edge.model_dump(by_alias=True) for edge in path],
    }


@router.get("/related")
async def related(
    tenant_id: int,
    entity_type: str,
    entity_id: str,
    request: Request,
    predicate: str | None = None,
    max_hops: int = 1,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.retrieve")
    edges = await request.app.state.knowledge_graph.list_edges(tenant_id)
    selected = related_edges(edges, entity_type=entity_type, entity_id=entity_id, predicate=predicate, max_hops=max_hops)
    return {"schema": "datasnare-knowledge/related-v1", "tenant_id": tenant_id, "entity": {"type": entity_type, "id": entity_id}, "edges": [edge.model_dump(by_alias=True) for edge in selected]}
