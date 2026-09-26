from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Literal, Protocol
from uuid import uuid4


IngestJobState = Literal["queued", "running", "completed", "failed", "cancelled"]


@dataclass(frozen=True)
class IngestJobRecord:
    tenant_id: int
    tool_id: str
    artifact_name: str
    artifact_type: str
    requested_by: str
    job_id: str = field(default_factory=lambda: str(uuid4()))
    schema: str = "datasnare-ingest/job-v1"
    state: IngestJobState = "queued"
    created_at: datetime | None = None
    updated_at: datetime | None = None
    normalized_schema: str | None = None
    native_conversion: dict | None = None


class IngestJobRepository(Protocol):
    async def create(self, record: IngestJobRecord) -> IngestJobRecord: ...

    async def list_for_tenant(self, tenant_id: int) -> list[IngestJobRecord]: ...

    async def get(self, tenant_id: int, job_id: str) -> IngestJobRecord | None: ...

    async def update(self, tenant_id: int, job_id: str, **changes) -> IngestJobRecord | None: ...


class InMemoryIngestJobRepository:
    """Replaceable repository for local development and route tests."""

    def __init__(self):
        self._records: dict[tuple[int, str], IngestJobRecord] = {}

    async def create(self, record: IngestJobRecord) -> IngestJobRecord:
        now = datetime.now(timezone.utc)
        saved = replace(record, created_at=now, updated_at=now)
        self._records[(saved.tenant_id, saved.job_id)] = saved
        return saved

    async def list_for_tenant(self, tenant_id: int) -> list[IngestJobRecord]:
        return sorted(
            [record for (record_tenant_id, _), record in self._records.items() if record_tenant_id == tenant_id],
            key=lambda record: record.created_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )

    async def get(self, tenant_id: int, job_id: str) -> IngestJobRecord | None:
        return self._records.get((tenant_id, job_id))

    async def update(self, tenant_id: int, job_id: str, **changes) -> IngestJobRecord | None:
        current = self._records.get((tenant_id, job_id))
        if current is None:
            return None
        saved = replace(current, **changes, updated_at=datetime.now(timezone.utc))
        self._records[(tenant_id, job_id)] = saved
        return saved