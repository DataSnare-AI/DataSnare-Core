from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


class KnowledgeEdge(BaseModel):
    schema_: str = Field(default="datasnare-knowledge/edge-v1", alias="schema")
    tenant_id: int = 0
    edge_id: str = Field(default_factory=lambda: f"edge_{uuid4().hex}")
    subject_type: str = Field(min_length=1)
    subject_id: str = Field(min_length=1)
    predicate: str = Field(min_length=1)
    object_type: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}
