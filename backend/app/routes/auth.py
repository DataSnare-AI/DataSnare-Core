from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/auth", tags=["Authentication"])

MIN_PASSWORD_LENGTH = 12


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


class PasswordSetupCompleteRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


async def _load_setup_token(pool, raw_token: str):
    return await pool.fetchrow(
        """
        SELECT t.username, t.email, t.expires_at, t.consumed_at, u.display_name
        FROM core_password_setup_tokens t
        JOIN core_users u ON u.username = t.username
        WHERE t.token_hash = $1
        LIMIT 1
        """,
        hashlib.sha256(raw_token.encode()).hexdigest(),
    )


def _assert_token_usable(row) -> None:
    if not row:
        raise HTTPException(status_code=404, detail="Password setup link is invalid")
    if row["consumed_at"] is not None:
        raise HTTPException(status_code=400, detail="Password setup link has already been used")
    if row["expires_at"] is None or row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Password setup link has expired")


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    provider = getattr(request.app.state, "auth_provider", None)
    if provider is None or not hasattr(provider, "login"):
        raise HTTPException(status_code=503, detail="Shared identity provider is not configured")
    return await provider.login(body.username, body.password)


@router.get("/profile")
async def profile(request: Request):
    provider = getattr(request.app.state, "auth_provider", None)
    if provider is None or not hasattr(provider, "profile"):
        raise HTTPException(status_code=503, detail="Shared identity provider is not configured")
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer authentication is required")
    identity = await provider.profile(authorization)
    actor_id = str(identity.get("username") or identity.get("actor_id") or "").strip()
    if not actor_id:
        raise HTTPException(status_code=502, detail="Shared identity response is missing an actor identifier")

    memberships = await request.app.state.product_accounts.list_for_actor(actor_id)
    subscriptions = []
    tenant_roles = {}
    for membership in memberships:
        tenant_id = int(membership["tenant_id"])
        tenant_roles.setdefault(str(tenant_id), []).append(membership["role_key"])
        if not membership.get("product_key"):
            continue
        limits = membership.get("entitlements") or {}
        overrides = membership.get("limits_override") or {}
        subscriptions.append({
            "tenant_id": tenant_id,
            "tenant_name": membership["tenant_name"],
            "product_key": membership["product_key"],
            "product_name": membership["product_name"],
            "plan": membership["plan_key"],
            "plan_key": membership["plan_key"],
            "plan_name": membership["plan_name"],
            "price_monthly": str(membership["price_monthly"]) if membership.get("price_monthly") is not None else None,
            "currency": membership.get("currency") or "USD",
            "account_status": membership["entitlement_status"],
            "effective_start_date": membership["effective_start_date"].isoformat() if membership.get("effective_start_date") else None,
            "effective_end_date": membership["effective_end_date"].isoformat() if membership.get("effective_end_date") else None,
            "limits": {
                "users_allocated": overrides.get("max_users", limits.get("max_users")),
                "systems_allocated": overrides.get("max_systems", limits.get("max_systems")),
            },
        })

    return {
        **identity,
        "tenant_roles": tenant_roles,
        "tenant_subscriptions": subscriptions,
        "account_source": "core-product-catalog",
    }


@router.post("/logout")
async def logout(request: Request):
    provider = getattr(request.app.state, "auth_provider", None)
    if provider is None or not hasattr(provider, "logout"):
        raise HTTPException(status_code=503, detail="Shared identity provider is not configured")
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer authentication is required")
    return await provider.logout(authorization)


@router.get("/introspect")
async def introspect(request: Request, tenant_id: int):
    provider = getattr(request.app.state, "auth_provider", None)
    if provider is None or not hasattr(provider, "introspect"):
        raise HTTPException(status_code=503, detail="Core identity provider is not configured")
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer authentication is required")
    return await provider.introspect(authorization, tenant_id)


@router.get("/password-setup/validate")
async def validate_password_setup(request: Request, token: str):
    pool = request.app.state.database_pool
    if pool is None:
        raise HTTPException(status_code=503, detail="Core identity storage is not configured")
    row = await _load_setup_token(pool, token.strip())
    _assert_token_usable(row)
    return {
        "valid": True,
        "username": row["username"],
        "email": row["email"],
        "display_name": row["display_name"] or row["username"],
        "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
    }


@router.post("/password-setup/complete")
async def complete_password_setup(body: PasswordSetupCompleteRequest, request: Request):
    pool = request.app.state.database_pool
    if pool is None:
        raise HTTPException(status_code=503, detail="Core identity storage is not configured")

    raw_token = body.token.strip()
    row = await _load_setup_token(pool, raw_token)
    _assert_token_usable(row)

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(rounds=12)).decode()
    await pool.execute(
        "UPDATE core_users SET password_hash = $2, is_active = TRUE, updated_at = NOW() WHERE username = $1",
        row["username"], password_hash,
    )
    await pool.execute(
        "UPDATE core_password_setup_tokens SET consumed_at = NOW(), consumed_by_ip = $2 WHERE token_hash = $1",
        hashlib.sha256(raw_token.encode()).hexdigest(),
        request.client.host if request.client else None,
    )
    await pool.execute(
        "UPDATE core_auth_sessions SET revoked_at = NOW() WHERE username = $1 AND revoked_at IS NULL",
        row["username"],
    )
    return {"status": "password_set", "username": row["username"]}
