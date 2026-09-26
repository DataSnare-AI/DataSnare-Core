from __future__ import annotations

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance
from app.services.chunking import chunk_text
from app.services.vector_store import VectorDocument


async def store_knowledge_item(request, *, tenant_id: int, actor_id: str, item: KnowledgeItem) -> KnowledgeItem:
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


def build_knowledge_item(tenant_id: int, actor_id: str, *, item_type: str, source_id: str, source_name: str | None, title: str | None, text: str, agent_id: str | None, site_id: str | None, area_id: str | None, classification: str, metadata: dict) -> KnowledgeItem:
    return KnowledgeItem(
        tenant_id=tenant_id,
        item_id=f"knowledge_{__import__('uuid').uuid4().hex}",
        item_type=item_type,
        title=title,
        text=text,
        metadata={**metadata, "ingested_by": actor_id, "classification": classification.lower()},
        provenance=KnowledgeProvenance(source_type=item_type, source_id=source_id, source_name=source_name, agent_id=agent_id, site_id=site_id, area_id=area_id),
    )
