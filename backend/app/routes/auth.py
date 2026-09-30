from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


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
