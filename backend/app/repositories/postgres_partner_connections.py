from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app.repositories.partner_connections import PartnerConnectionRecord


class PostgresPartnerConnectionRepository:
    """Durable, tenant-scoped storage for partner credentials and OAuth state."""

    def __init__(self, db):
        self.db = db

    async def get(self, tenant_id: int, provider: str) -> PartnerConnectionRecord | None:
        row = await self.db.fetchrow(
            """
            SELECT tenant_id, provider, base_url, client_id, redirect_uri, scopes,
                   client_secret_enc, refresh_token_enc, connected, updated_at
            FROM core_partner_connections
            WHERE tenant_id = $1 AND provider = $2
            """,
            tenant_id,
            provider,
        )
        return _record_from_row(row) if row else None

    async def save(self, record: PartnerConnectionRecord) -> PartnerConnectionRecord:
        row = await self.db.fetchrow(
            """
            INSERT INTO core_partner_connections (
                tenant_id, provider, base_url, client_id, redirect_uri, scopes,
                client_secret_enc, refresh_token_enc, connected
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
            ON CONFLICT (tenant_id, provider) DO UPDATE SET
                base_url = EXCLUDED.base_url,
                client_id = EXCLUDED.client_id,
                redirect_uri = EXCLUDED.redirect_uri,
                scopes = EXCLUDED.scopes,
                client_secret_enc = EXCLUDED.client_secret_enc,
                refresh_token_enc = NULL,
                connected = FALSE,
                updated_at = NOW()
            RETURNING tenant_id, provider, base_url, client_id, redirect_uri, scopes,
                      client_secret_enc, refresh_token_enc, connected, updated_at
            """,
            record.tenant_id,
            record.provider,
            record.base_url,
            record.client_id,
            record.redirect_uri,
            json.dumps(record.scopes),
            record.encrypted_client_secret,
            record.encrypted_refresh_token,
            record.connected,
        )
        return _record_from_row(row)

    async def save_oauth_state(self, state_hash: str, tenant_id: int, expires_at: datetime) -> None:
        await self.db.execute("DELETE FROM ninjaone_oauth_states WHERE expires_at <= NOW()")
        await self.db.execute(
            """
            INSERT INTO ninjaone_oauth_states (state_hash, tenant_id, expires_at)
            VALUES ($1, $2, $3)
            """,
            state_hash,
            tenant_id,
            expires_at,
        )

    async def consume_oauth_state(self, state_hash: str) -> int | None:
        row = await self.db.fetchrow(
            """
            DELETE FROM ninjaone_oauth_states
            WHERE state_hash = $1 AND expires_at > NOW()
            RETURNING tenant_id
            """,
            state_hash,
        )
        return row["tenant_id"] if row else None

    async def save_refresh_token(self, tenant_id: int, encrypted_refresh_token: str) -> bool:
        result = await self.db.execute(
            """
            UPDATE core_partner_connections
            SET refresh_token_enc = $2, connected = TRUE, updated_at = NOW()
            WHERE tenant_id = $1 AND provider = 'ninjaone'
            """,
            tenant_id,
            encrypted_refresh_token,
        )
        return result.endswith(" 1")


def _record_from_row(row: Any) -> PartnerConnectionRecord:
    scopes = row["scopes"]
    if isinstance(scopes, str):
        scopes = json.loads(scopes)
    return PartnerConnectionRecord(
        tenant_id=row["tenant_id"],
        provider=row["provider"],
        base_url=row["base_url"],
        client_id=row["client_id"],
        redirect_uri=row["redirect_uri"],
        scopes=tuple(scopes or []),
        encrypted_client_secret=row["client_secret_enc"],
        encrypted_refresh_token=row["refresh_token_enc"],
        connected=row["connected"],
        updated_at=row["updated_at"],
    )