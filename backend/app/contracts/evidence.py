from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


SUPPORTED_EVIDENCE_TYPES = {
    "telemetry",
    "event",
    "alert",
    "change",
    "action",
    "incident",
    "runbook",
    "document",
    "knowledge_article",
    "metric",
    "log",
}


class EvidenceIngestRequest(BaseModel):
    item_type: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_name: str | None = None
    title: str | None = None
    text: str = Field(min_length=1, max_length=2_000_000)
    agent_id: str | None = None
    site_id: str | None = None
    area_id: str | None = None
    classification: str = "internal"
    metadata: dict[str, Any] = Field(default_factory=dict)

    def normalized_item_type(self) -> str:
        value = self.item_type.strip().lower()
        if value not in SUPPORTED_EVIDENCE_TYPES:
            supported = ", ".join(sorted(SUPPORTED_EVIDENCE_TYPES))
            raise ValueError(f"Unsupported evidence type '{value}'. Supported: {supported}")
        return value
