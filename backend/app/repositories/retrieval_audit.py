from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4


@dataclass(frozen=True)
class RetrievalAuditEvent:
    tenant_id: int
    actor_id: str
    retrieval_id: str
    status: str
    routed_agent_ids: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: f"audit_{uuid4().hex}")
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class RetrievalAuditRepository(Protocol):
    async def append(self, event: RetrievalAuditEvent) -> RetrievalAuditEvent: ...

    async def list_for_tenant(self, tenant_id: int) -> list[RetrievalAuditEvent]: ...


class InMemoryRetrievalAuditRepository:
    def __init__(self):
        self._events: list[RetrievalAuditEvent] = []

    async def append(self, event: RetrievalAuditEvent) -> RetrievalAuditEvent:
        self._events.append(event)
        return event

    async def list_for_tenant(self, tenant_id: int) -> list[RetrievalAuditEvent]:
        return [event for event in self._events if event.tenant_id == tenant_id]
