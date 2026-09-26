from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


class InMemorySiteQueryCache:
    """Replaceable tenant/site cache boundary for DS-RAG-023."""

    def __init__(self, ttl_seconds: int = 60):
        self.ttl = timedelta(seconds=ttl_seconds)
        self._entries: dict[tuple[int, str], tuple[datetime, Any]] = {}

    async def get(self, tenant_id: int, cache_key: str) -> Any | None:
        entry = self._entries.get((tenant_id, cache_key))
        if not entry:
            return None
        expires_at, value = entry
        if expires_at <= datetime.now(timezone.utc):
            self._entries.pop((tenant_id, cache_key), None)
            return None
        return value

    async def set(self, tenant_id: int, cache_key: str, value: Any) -> None:
        self._entries[(tenant_id, cache_key)] = (datetime.now(timezone.utc) + self.ttl, value)