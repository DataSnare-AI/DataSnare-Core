from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.routes.admin_users import _require_platform_admin
from app.security.authorization import ROLE_PERMISSIONS


router = APIRouter(prefix="/api/admin", tags=["Tenant Administration"])

ASSIGNABLE_ROLES = set(ROLE_PERMISSIONS)
DEFAULT_IDENTITY_ISSUER = "datasnare-core-local"


class TenantCreateRequest(BaseModel):
    tenant_id: int | None = None
    display_name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active")


class TenantUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)
    status: str | None = None


class EntitlementRequest(BaseModel):
    product_key: str = Field(min_length=1, max_length=64)
    plan_key: str = Field(min_length=1, max_length=64)
    status: str = Field(default="active")
    effective_start_date: date | None = None
    effective_end_date: date | None = None
    max_users: int | None = Field(default=None, ge=0)
    max_systems: int | None = Field(default=None, ge=0)


class MembershipRequest(BaseModel):
    actor_id: str = Field(min_length=1, max_length=255)
    role_key: str = Field(min_length=1, max_length=64)
    identity_issuer: str = Field(default=DEFAULT_IDENTITY_ISSUER, max_length=128)


class PlanUpsertRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    price_monthly: float | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    max_users: int | None = Field(default=None, ge=0)
    max_systems: int | None = Field(default=None, ge=0)
    is_active: bool = True


def _validate_role(role: str) -> str:
    normalized = role.strip().lower()
    if normalized not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail=f"Unsupported role '{role}'")
    return normalized


def _serialize(row) -> dict:
    record = dict(row)
    for key, value in record.items():
        if hasattr(value, "isoformat"):
            record[key] = value.isoformat()
    return record


@router.get("/tenants")
async def list_tenants(request: Request):
    await _require_platform_admin(request)
    rows = await request.app.state.database_pool.fetch(
        """
        SELECT t.tenant_id, t.display_name, t.status, t.source_system, t.created_at,
               e.product_key, e.plan_key, e.status AS entitlement_status,
               e.effective_start_date, e.effective_end_date, e.limits_override,
               (SELECT count(*) FROM core_tenant_memberships m
                 WHERE m.tenant_id = t.tenant_id AND m.status = 'active') AS member_count
        FROM core_tenants t
        LEFT JOIN core_tenant_product_entitlements e ON e.tenant_id = t.tenant_id
        ORDER BY t.tenant_id, e.product_key
        """
    )
    return {"schema": "datasnare-core/tenant-list-v1", "tenants": [_serialize(row) for row in rows]}


@router.post("/tenants", status_code=201)
async def create_tenant(body: TenantCreateRequest, request: Request):
    await _require_platform_admin(request)
    pool = request.app.state.database_pool

    # Tenant IDs stay compatible with existing product identifiers, so allow an explicit value.
    tenant_id = body.tenant_id
    if tenant_id is None:
        tenant_id = await pool.fetchval("SELECT COALESCE(MAX(tenant_id), 0) + 1 FROM core_tenants")
    elif await pool.fetchval("SELECT 1 FROM core_tenants WHERE tenant_id = $1", tenant_id):
        raise HTTPException(status_code=409, detail="A tenant with that id already exists")

    row = await pool.fetchrow(
        """
        INSERT INTO core_tenants (tenant_id, display_name, status, source_system)
        VALUES ($1, $2, $3, 'core')
        RETURNING tenant_id, display_name, status, source_system, created_at
        """,
        tenant_id, body.display_name.strip(), body.status.strip().lower(),
    )
    return _serialize(row)


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: int, body: TenantUpdateRequest, request: Request):
    await _require_platform_admin(request)
    updates: dict[str, object] = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name.strip()
    if body.status is not None:
        updates["status"] = body.status.strip().lower()
    if not updates:
        raise HTTPException(status_code=400, detail="No supported fields were provided")

    assignments = ", ".join(f"{column} = ${index}" for index, column in enumerate(updates, start=1))
    values = [*updates.values(), tenant_id]
    row = await request.app.state.database_pool.fetchrow(
        f"""
        UPDATE core_tenants SET {assignments}, updated_at = NOW()
        WHERE tenant_id = ${len(values)}
        RETURNING tenant_id, display_name, status, source_system, created_at
        """,
        *values,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return _serialize(row)


@router.get("/catalog")
async def list_catalog(request: Request):
    await _require_platform_admin(request)
    rows = await request.app.state.database_pool.fetch(
        """
        SELECT p.product_key, p.display_name AS product_name, p.is_active AS product_active,
               pl.plan_key, pl.display_name AS plan_name, pl.price_monthly, pl.currency,
               pl.entitlements, pl.is_active AS plan_active
        FROM core_products p
        LEFT JOIN core_product_plans pl ON pl.product_key = p.product_key
        ORDER BY p.product_key, pl.price_monthly NULLS FIRST
        """
    )
    return {"schema": "datasnare-core/catalog-v1", "entries": [_serialize(row) for row in rows]}


@router.put("/catalog/{product_key}/plans/{plan_key}")
async def upsert_plan(product_key: str, plan_key: str, body: PlanUpsertRequest, request: Request):
    await _require_platform_admin(request)
    pool = request.app.state.database_pool

    if not await pool.fetchval("SELECT 1 FROM core_products WHERE product_key = $1", product_key):
        raise HTTPException(status_code=404, detail="Product not found")

    entitlements = {
        key: value for key, value in
        {"max_users": body.max_users, "max_systems": body.max_systems}.items()
        if value is not None
    }
    row = await pool.fetchrow(
        """
        INSERT INTO core_product_plans
            (product_key, plan_key, display_name, description, price_monthly, currency, entitlements, is_active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
        ON CONFLICT (product_key, plan_key) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            description = EXCLUDED.description,
            price_monthly = EXCLUDED.price_monthly,
            currency = EXCLUDED.currency,
            entitlements = EXCLUDED.entitlements,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
        RETURNING product_key, plan_key, display_name, description, price_monthly, currency, entitlements, is_active
        """,
        product_key, plan_key, body.display_name, body.description,
        body.price_monthly, body.currency.upper(), json.dumps(entitlements), body.is_active,
    )
    return _serialize(row)


@router.put("/tenants/{tenant_id}/entitlements")
async def assign_entitlement(tenant_id: int, body: EntitlementRequest, request: Request):
    actor = await _require_platform_admin(request)
    pool = request.app.state.database_pool

    if not await pool.fetchval("SELECT 1 FROM core_tenants WHERE tenant_id = $1", tenant_id):
        raise HTTPException(status_code=404, detail="Tenant not found")
    plan = await pool.fetchval(
        "SELECT 1 FROM core_product_plans WHERE product_key = $1 AND plan_key = $2 AND is_active = TRUE",
        body.product_key, body.plan_key,
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Active plan not found for that product")

    overrides = {
        key: value for key, value in
        {"max_users": body.max_users, "max_systems": body.max_systems}.items()
        if value is not None
    }
    row = await pool.fetchrow(
        """
        INSERT INTO core_tenant_product_entitlements
            (tenant_id, product_key, plan_key, status, effective_start_date, effective_end_date,
             limits_override, source_system, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'core', jsonb_build_object('updated_by', $8::text), NOW())
        ON CONFLICT (tenant_id, product_key) DO UPDATE SET
            plan_key = EXCLUDED.plan_key,
            status = EXCLUDED.status,
            effective_start_date = EXCLUDED.effective_start_date,
            effective_end_date = EXCLUDED.effective_end_date,
            limits_override = EXCLUDED.limits_override,
            source_system = 'core',
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING tenant_id, product_key, plan_key, status, effective_start_date,
                  effective_end_date, limits_override, source_system
        """,
        tenant_id, body.product_key, body.plan_key, body.status.strip().lower(),
        body.effective_start_date, body.effective_end_date,
        json.dumps(overrides), actor,
    )
    return _serialize(row)


@router.delete("/tenants/{tenant_id}/entitlements/{product_key}")
async def revoke_entitlement(tenant_id: int, product_key: str, request: Request):
    await _require_platform_admin(request)
    row = await request.app.state.database_pool.fetchrow(
        """
        UPDATE core_tenant_product_entitlements
        SET status = 'revoked', updated_at = NOW()
        WHERE tenant_id = $1 AND product_key = $2
        RETURNING tenant_id, product_key, plan_key, status
        """,
        tenant_id, product_key,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Entitlement not found")
    return _serialize(row)


@router.get("/tenants/{tenant_id}/members")
async def list_members(tenant_id: int, request: Request):
    await _require_platform_admin(request)
    rows = await request.app.state.database_pool.fetch(
        """
        SELECT m.tenant_id, m.identity_issuer, m.identity_subject, m.actor_id,
               m.role_key, m.status, u.display_name, u.is_active AS user_active
        FROM core_tenant_memberships m
        LEFT JOIN core_users u ON u.username = m.actor_id
        WHERE m.tenant_id = $1
        ORDER BY m.actor_id
        """,
        tenant_id,
    )
    return {"schema": "datasnare-core/tenant-member-list-v1", "members": [_serialize(row) for row in rows]}


@router.put("/tenants/{tenant_id}/members")
async def assign_member(tenant_id: int, body: MembershipRequest, request: Request):
    await _require_platform_admin(request)
    pool = request.app.state.database_pool
    role = _validate_role(body.role_key)

    if not await pool.fetchval("SELECT 1 FROM core_tenants WHERE tenant_id = $1", tenant_id):
        raise HTTPException(status_code=404, detail="Tenant not found")
    if not await pool.fetchval("SELECT 1 FROM core_users WHERE username = $1", body.actor_id):
        raise HTTPException(status_code=404, detail="User not found")

    row = await pool.fetchrow(
        """
        INSERT INTO core_tenant_memberships
            (tenant_id, identity_issuer, identity_subject, actor_id, role_key, status, updated_at)
        VALUES ($1, $2, $3, $3, $4, 'active', NOW())
        ON CONFLICT (tenant_id, identity_issuer, identity_subject) DO UPDATE SET
            actor_id = EXCLUDED.actor_id,
            role_key = EXCLUDED.role_key,
            status = 'active',
            updated_at = NOW()
        RETURNING tenant_id, identity_issuer, identity_subject, actor_id, role_key, status
        """,
        tenant_id, body.identity_issuer, body.actor_id, role,
    )
    return _serialize(row)


@router.delete("/tenants/{tenant_id}/members/{actor_id}")
async def remove_member(tenant_id: int, actor_id: str, request: Request):
    await _require_platform_admin(request)
    row = await request.app.state.database_pool.fetchrow(
        """
        UPDATE core_tenant_memberships
        SET status = 'inactive', updated_at = NOW()
        WHERE tenant_id = $1 AND actor_id = $2 AND status = 'active'
        RETURNING tenant_id, actor_id, role_key, status
        """,
        tenant_id, actor_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Active membership not found")
    return _serialize(row)
