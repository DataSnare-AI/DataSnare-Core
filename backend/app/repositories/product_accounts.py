from __future__ import annotations

import json
from typing import Protocol


class ProductAccountRepository(Protocol):
    async def list_for_actor(self, actor_id: str) -> list[dict]: ...


class InMemoryProductAccountRepository:
    def __init__(self, memberships: list[dict] | None = None):
        self.memberships = list(memberships or [])

    async def list_for_actor(self, actor_id: str) -> list[dict]:
        return [dict(item) for item in self.memberships if item.get("actor_id") == actor_id and item.get("status", "active") == "active"]


class PostgresProductAccountRepository:
    def __init__(self, pool):
        self.pool = pool

    async def list_for_actor(self, actor_id: str) -> list[dict]:
        rows = await self.pool.fetch(
            """
            SELECT
                m.tenant_id,
                t.display_name AS tenant_name,
                m.role_key,
                t.status AS tenant_status,
                e.product_key,
                p.display_name AS product_name,
                e.plan_key,
                pl.display_name AS plan_name,
                pl.price_monthly,
                pl.currency,
                pl.entitlements,
                e.status AS entitlement_status,
                e.effective_start_date,
                e.effective_end_date,
                e.limits_override,
                e.source_system,
                e.source_record_key
            FROM core_tenant_memberships m
            JOIN core_tenants t ON t.tenant_id = m.tenant_id
            LEFT JOIN core_tenant_product_entitlements e ON e.tenant_id = m.tenant_id
            LEFT JOIN core_products p ON p.product_key = e.product_key
            LEFT JOIN core_product_plans pl
                ON pl.product_key = e.product_key AND pl.plan_key = e.plan_key
            WHERE m.actor_id = $1
              AND m.status = 'active'
              AND t.status = 'active'
            ORDER BY t.display_name, e.product_key
            """,
            actor_id,
        )
        records = []
        for row in rows:
            record = dict(row)
            for field in ("entitlements", "limits_override"):
                value = record.get(field)
                if isinstance(value, str):
                    try:
                        decoded = json.loads(value)
                        record[field] = decoded if isinstance(decoded, dict) else {}
                    except json.JSONDecodeError:
                        record[field] = {}
                elif value is None:
                    record[field] = {}
            records.append(record)
        return records