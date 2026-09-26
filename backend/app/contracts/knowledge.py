from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeProvenance(BaseModel):
    source_type: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_name: str | None = None
    agent_id: str | None = None
    site_id: str | None = None
    area_id: str | None = None
    observed_at: datetime | None = None


class KnowledgeItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_: str = Field(default="datasnare-knowledge/item-v1", alias="schema")
    tenant_id: int
    item_id: str = Field(min_length=1)
    item_type: str = Field(min_length=1)
    title: str | None = None
    text: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    provenance: KnowledgeProvenance


class RagRetrieveRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=10, ge=1, le=100)
    site_id: str | None = None
    area_id: str | None = None
    agent_id: str | None = None
    item_types: list[str] = Field(default_factory=list)


class RagRetrievalResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_: str = Field(default="datasnare-rag/retrieval-v1", alias="schema")
    retrieval_id: str
    tenant_id: int
    actor_id: str
    status: str
    query: str
    results: list[KnowledgeItem] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    audit_event: dict[str, Any]
