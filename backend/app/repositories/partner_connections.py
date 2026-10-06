from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Protocol


@dataclass(frozen=True)
class PartnerConnectionRecord:
    tenant_id: int
    provider: str
    base_url: str
    client_id: str
    redirect_uri: str
    scopes: tuple[str, ...]
    encrypted_client_secret: str | None = None
    encrypted_refresh_token: str | None = None
    connected: bool = False
    updated_at: datetime | None = None


class PartnerConnectionRepository(Protocol):
    async def get(self, tenant_id: int, provider: str) -> PartnerConnectionRecord | None: ...

    async def save(self, record: PartnerConnectionRecord) -> PartnerConnectionRecord: ...

    async def save_oauth_state(self, state_hash: str, tenant_id: int, expires_at: datetime) -> None: ...

    async def consume_oauth_state(self, state_hash: str) -> int | None: ...

    async def save_refresh_token(self, tenant_id: int, encrypted_refresh_token: str) -> bool: ...


class InMemoryPartnerConnectionRepository:
    """Replaceable repository for local development and route tests."""

    def __init__(self):
        self._records: dict[tuple[int, str], PartnerConnectionRecord] = {}
        self._oauth_states: dict[str, tuple[int, datetime]] = {}

    async def get(self, tenant_id: int, provider: str) -> PartnerConnectionRecord | None:
        return self._records.get((tenant_id, provider))

    async def save(self, record: PartnerConnectionRecord) -> PartnerConnectionRecord:
        saved = replace(record, updated_at=datetime.now(timezone.utc))
        self._records[(saved.tenant_id, saved.provider)] = saved
        return saved

    async def save_oauth_state(self, state_hash: str, tenant_id: int, expires_at: datetime) -> None:
        now = datetime.now(timezone.utc)
        self._oauth_states = {
            key: value for key, value in self._oauth_states.items() if value[1] > now
        }
        self._oauth_states[state_hash] = (tenant_id, expires_at)

    async def consume_oauth_state(self, state_hash: str) -> int | None:
        value = self._oauth_states.pop(state_hash, None)
        if value is None or value[1] <= datetime.now(timezone.utc):
            return None
        return value[0]

    async def save_refresh_token(self, tenant_id: int, encrypted_refresh_token: str) -> bool:
        key = (tenant_id, "ninjaone")
        record = self._records.get(key)
        if record is None:
            return False
        self._records[key] = replace(
            record,
            encrypted_refresh_token=encrypted_refresh_token,
            connected=True,
            updated_at=datetime.now(timezone.utc),
        )
        return True