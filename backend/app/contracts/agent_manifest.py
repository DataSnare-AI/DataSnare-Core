from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AgentManifest(BaseModel):
    schema_: str = Field(default="datasnare-rag/agent-manifest-v1", alias="schema")
    tenant_id: int
    agent_id: str = Field(min_length=1)
    system_name: str = Field(min_length=1)
    site_id: str | None = None
    area_id: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    knowledge_types: list[str] = Field(default_factory=list)
    status: str = "unknown"
    last_seen_at: datetime | None = None
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class AgentManifestUpsertRequest(BaseModel):
    agent_id: str = Field(min_length=1)
    system_name: str = Field(min_length=1)
    site_id: str | None = None
    area_id: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    knowledge_types: list[str] = Field(default_factory=list)
    status: str = "online"
    last_seen_at: datetime | None = None
    metadata: dict = Field(default_factory=dict)
