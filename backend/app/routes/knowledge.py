from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance
from app.contracts.evidence import EvidenceIngestRequest
from app.security.authorization import require_permission, resolve_actor
from app.services.chunking import chunk_text
from app.services.vector_store import VectorDocument
from app.services.knowledge_ingestion import build_knowledge_item, store_knowledge_item


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
    classification: str = "internal"


@router.post("/documents", response_model=KnowledgeItem, status_code=201)
async def ingest_document(
    tenant_id: int,
    body: DocumentIngestRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.ingest")
    item = KnowledgeItem(
        tenant_id=tenant_id,
        item_id=f"knowledge_{uuid4().hex}",
        item_type=body.item_type,
        title=body.title,
        text=body.text,
        metadata={**body.metadata, "ingested_by": actor.actor_id, "classification": body.classification.lower()},
        provenance=KnowledgeProvenance(
            source_type=body.source_type,
            source_id=body.source_id,
            source_name=body.source_name,
            agent_id=body.agent_id,
            site_id=body.site_id,
            area_id=body.area_id,
        ),
    )
    saved = await request.app.state.knowledge_items.create(item)
    chunks = chunk_text(saved.text)
    embeddings = request.app.state.embedding_provider.embed_batch([chunk.text for chunk in chunks])
    for chunk, embedding in zip(chunks, embeddings):
        await request.app.state.vector_store.upsert(VectorDocument(
            tenant_id=tenant_id,
            item_id=f"{saved.item_id}:chunk:{chunk.chunk_index}",
            text=chunk.text,
            vector=embedding.vector,
            metadata={
                "knowledge_item_id": saved.item_id,
                "chunk_index": chunk.chunk_index,
                "start_offset": chunk.start_offset,
                "end_offset": chunk.end_offset,
                "title": saved.title,
                "source_type": saved.provenance.source_type,
                "source_id": saved.provenance.source_id,
                "source_name": saved.provenance.source_name,
                "agent_id": saved.provenance.agent_id,
                "site_id": saved.provenance.site_id,
                "area_id": saved.provenance.area_id,
                "classification": saved.metadata.get("classification", "internal"),
            },
        ))
    return saved


@router.post("/evidence", response_model=KnowledgeItem, status_code=201)
async def ingest_evidence(
    tenant_id: int,
    body: EvidenceIngestRequest,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    actor = require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.ingest")
    try:
        item_type = body.normalized_item_type()
    except ValueError as error:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=str(error)) from error
    item = build_knowledge_item(tenant_id, actor.actor_id, item_type=item_type, source_id=body.source_id, source_name=body.source_name, title=body.title, text=body.text, agent_id=body.agent_id, site_id=body.site_id, area_id=body.area_id, classification=body.classification, metadata=body.metadata)
    return await store_knowledge_item(request, tenant_id=tenant_id, actor_id=actor.actor_id, item=item)


@router.get("/documents", response_model=list[KnowledgeItem])
async def list_documents(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.retrieve")
    return await request.app.state.knowledge_items.list_for_tenant(tenant_id)


@router.get("/catalog")
async def knowledge_catalog(
    tenant_id: int,
    request: Request,
    x_actor: str | None = Header(default=None),
    x_role: str | None = Header(default=None),
):
    require_permission(await resolve_actor(tenant_id, x_actor, x_role, request=request), "rag.retrieve")
    items = await request.app.state.knowledge_items.list_for_tenant(tenant_id)
    by_type: dict[str, int] = {}
    by_classification: dict[str, int] = {}
    agents: set[str] = set()
    sites: set[str] = set()
    areas: set[str] = set()
    sources: set[str] = set()
    for item in items:
        by_type[item.item_type] = by_type.get(item.item_type, 0) + 1
        classification = str(item.metadata.get("classification", "internal"))
        by_classification[classification] = by_classification.get(classification, 0) + 1
        if item.provenance.agent_id: agents.add(item.provenance.agent_id)
        if item.provenance.site_id: sites.add(item.provenance.site_id)
        if item.provenance.area_id: areas.add(item.provenance.area_id)
        sources.add(item.provenance.source_type)
    return {
        "schema": "datasnare-knowledge/catalog-v1",
        "tenant_id": tenant_id,
        "item_count": len(items),
        "by_type": by_type,
        "by_classification": by_classification,
        "agent_ids": sorted(agents),
        "site_ids": sorted(sites),
        "area_ids": sorted(areas),
        "source_types": sorted(sources),
    }
