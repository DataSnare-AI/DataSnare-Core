from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import aiohttp
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.repositories.partner_connections import PartnerConnectionRecord
from app.security.authorization import require_permission, resolve_actor
from app.services.artifact_storage import CoreArtifactStorage
from app.services.ninjaone import NinjaOneError, NinjaOneOAuthConfig, exchange_authorization_code


router = APIRouter(prefix="/api/tenants/{tenant_id}/integrations/ninjaone", tags=["NinjaOne"])
callback_router = APIRouter(prefix="/api/integrations/ninjaone", tags=["NinjaOne"])


class AuthorizationRequest(BaseModel):
    base_url: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    client_secret: str = Field(min_length=1, max_length=4096)
    redirect_uri: str = Field(min_length=1)
    scopes: list[str] = Field(default_factory=list)


async def _require_tenant_admin(tenant_id: int, request: Request, permission: str) -> None:
    actor = await resolve_actor(
        tenant_id,
        x_actor=request.headers.get("X-Actor"),
        x_role=request.headers.get("X-Role"),
        request=request,
        authorization=request.headers.get("Authorization"),
    )
    require_permission(actor, permission)


def _configured_redirect_uri() -> str:
    redirect_uri = os.getenv("NINJAONE_REDIRECT_URI", "").strip()
    parsed = urlparse(redirect_uri)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path != "/api/integrations/ninjaone/callback" or parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=503,
            detail="NINJAONE_REDIRECT_URI must be the HTTPS NinjaOne callback URL",
        )
    return redirect_uri


@router.get("/connection")
async def get_connection(tenant_id: int, request: Request):
    await _require_tenant_admin(tenant_id, request, "tenant.config.view")
    record = await request.app.state.partner_connections.get(tenant_id, "ninjaone")
    if not record:
        return {"provider": "ninjaone", "tenant_id": tenant_id, "connected": False}
    return {
        "provider": record.provider,
        "tenant_id": record.tenant_id,
        "base_url": record.base_url,
        "client_id": record.client_id,
        "redirect_uri": record.redirect_uri,
        "scopes": list(record.scopes),
        "connected": record.connected,
        "has_refresh_token": bool(record.encrypted_refresh_token),
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.post("/authorize")
async def begin_authorization(
    tenant_id: int,
    body: AuthorizationRequest,
    request: Request,
):
    await _require_tenant_admin(tenant_id, request, "tenant.config.edit")
    redirect_uri = _configured_redirect_uri()
    if body.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="Redirect URI must exactly match NINJAONE_REDIRECT_URI")
    scopes = tuple(sorted({scope.strip().lower() for scope in body.scopes if scope.strip()}))
    if set(scopes) - {"monitoring"}:
        raise HTTPException(status_code=400, detail="Only the NinjaOne Monitoring scope is enabled for this read-only integration")
    state = secrets.token_urlsafe(32)
    record = PartnerConnectionRecord(
        tenant_id=tenant_id,
        provider="ninjaone",
        base_url=body.base_url,
        client_id=body.client_id,
        redirect_uri=redirect_uri,
        scopes=scopes,
        encrypted_client_secret=CoreArtifactStorage.encrypt_secret(body.client_secret),
    )
    await request.app.state.partner_connections.save(record)
    await request.app.state.partner_connections.save_oauth_state(
        hashlib.sha256(state.encode()).hexdigest(),
        tenant_id,
        datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    config = NinjaOneOAuthConfig(
        client_id=body.client_id,
        client_secret=body.client_secret,
        redirect_uri=redirect_uri,
    )
    return {
        "provider": "ninjaone",
        "tenant_id": tenant_id,
        "authorization_url": config.authorization_request_url(state, scope=" ".join(scopes) or None),
        "state": state,
        "next_step": "redirect_user_to_authorization_url",
    }


@callback_router.get("/callback")
async def complete_authorization(
    request: Request,
    state: str = Query(min_length=16),
    code: str | None = None,
    error: str | None = None,
):
    _configured_redirect_uri()
    tenant_id = await request.app.state.partner_connections.consume_oauth_state(
        hashlib.sha256(state.encode()).hexdigest()
    )
    if tenant_id is None:
        raise HTTPException(status_code=400, detail="OAuth state is invalid, expired, or already used")
    if error:
        raise HTTPException(status_code=400, detail="NinjaOne authorization was not granted")
    if not code:
        raise HTTPException(status_code=400, detail="NinjaOne authorization code is missing")

    record = await request.app.state.partner_connections.get(tenant_id, "ninjaone")
    if record is None or not record.encrypted_client_secret:
        raise HTTPException(status_code=400, detail="NinjaOne connection setup is incomplete")
    config = NinjaOneOAuthConfig(
        client_id=record.client_id,
        client_secret=CoreArtifactStorage.decrypt_secret(record.encrypted_client_secret) or "",
        redirect_uri=record.redirect_uri,
    )
    try:
        async with aiohttp.ClientSession() as session:
            tokens = await exchange_authorization_code(config, code, session)
    except NinjaOneError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    encrypted_refresh_token = CoreArtifactStorage.encrypt_secret(tokens.get("refresh_token"))
    if not encrypted_refresh_token or not await request.app.state.partner_connections.save_refresh_token(
        tenant_id, encrypted_refresh_token
    ):
        raise HTTPException(status_code=500, detail="NinjaOne refresh token could not be persisted")
    return {"provider": "ninjaone", "tenant_id": tenant_id, "connected": True}