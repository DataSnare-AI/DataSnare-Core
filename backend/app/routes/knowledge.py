from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance
from app.security.authorization import require_permission, resolve_actor


router = APIRouter(prefix="/api/tenants/{tenant_id}/knowledge", tags=["Knowledge"])


class DocumentIngestRequest(BaseModel):
    source_type: str = Field(default="document", min_length=1)
    source_id: str = Field(min_length=1)
    source_name: str | None = None
    title: str | None = None
    text: str = Field(min_length=1, max_length=2_000_000)
    item_type: str = Field(default="document", min_length=1)
    agent_id: str | None = None
    site_id: str | None = None
    area_id: str | None = None
    metadata: dict = Field(default_factory=dict)


@router.post("/documents", response_model=KnowledgeItem, status_code=201)
async def ingest_document(
    tenant_id: int,
    body: DocumentIngestRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.ingest")
    item = KnowledgeItem(
        tenant_id=tenant_id,
        item_id=f"knowledge_{uuid4().hex}",
        item_type=body.item_type,
        title=body.title,
        text=body.text,
        metadata={**body.metadata, "ingested_by": actor.actor_id},
        provenance=KnowledgeProvenance(
            source_type=body.source_type,
            source_id=body.source_id,
            source_name=body.source_name,
            agent_id=body.agent_id,
            site_id=body.site_id,
            area_id=body.area_id,
        ),
    )
    return await request.app.state.knowledge_items.create(item)


@router.get("/documents", response_model=list[KnowledgeItem])
async def list_documents(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(resolve_actor(tenant_id, x_actor, x_role), "rag.retrieve")
    return await request.app.state.knowledge_items.list_for_tenant(tenant_id)
