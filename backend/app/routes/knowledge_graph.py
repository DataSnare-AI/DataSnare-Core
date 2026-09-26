from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.contracts.knowledge_graph import KnowledgeEdge
from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/knowledge/graph", tags=["Knowledge Graph"])


@router.post("/edges", response_model=KnowledgeEdge, status_code=201)
async def add_edge(
    tenant_id: int,
    edge: KnowledgeEdge,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.graph.manage")
    saved = edge.model_copy(update={"tenant_id": tenant_id, "metadata": {**edge.metadata, "created_by": actor.actor_id}})
    return await request.app.state.knowledge_graph.add_edge(saved)


@router.get("/edges", response_model=list[KnowledgeEdge])
async def list_edges(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.retrieve")
    return await request.app.state.knowledge_graph.list_edges(tenant_id)
