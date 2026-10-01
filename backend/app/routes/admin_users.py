from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.security.authorization import ROLE_PERMISSIONS


router = APIRouter(prefix="/api/admin/users", tags=["User Administration"])

MANAGEABLE_ROLES = set(ROLE_PERMISSIONS)
INVITE_PENDING_HASH = "!invite-pending!"
MIN_PASSWORD_LENGTH = 12


class PasswordSetupTokenRequest(BaseModel):
    email: str | None = Field(default=None, max_length=320)
    expires_in_hours: int = Field(default=72, ge=1, le=168)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str | None = Field(default=None, min_length=12, max_length=1024)
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=320)
    global_role: str = Field(default="viewer")


class UserUpdateRequest(BaseModel):
    password: str | None = Field(default=None, min_length=12, max_length=1024)
    display_name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=320)
    global_role: str | None = None
    is_active: bool | None = None


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def _validate_role(role: str) -> str:
    normalized = role.strip().lower()
    if normalized not in MANAGEABLE_ROLES:
        raise HTTPException(status_code=400, detail=f"Unsupported role '{role}'")
    return normalized


async def _require_platform_admin(request: Request) -> str:
    provider = getattr(request.app.state, "auth_provider", None)
    if provider is None or not hasattr(provider, "profile"):
        raise HTTPException(status_code=503, detail="Core identity provider is not configured")
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer authentication is required")
    identity = await provider.profile(authorization)
    if str(identity.get("role", "")).strip().lower() != "platform_admin":
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return str(identity.get("username") or identity.get("actor_id"))


def _user_payload(row) -> dict:
    record = dict(row)
    record.pop("password_hash", None)
    record["created_at"] = record["created_at"].isoformat() if record.get("created_at") else None
    record["last_login_at"] = record["last_login_at"].isoformat() if record.get("last_login_at") else None
    return record


@router.get("")
async def list_users(request: Request):
    await _require_platform_admin(request)
    rows = await request.app.state.database_pool.fetch(
        """
        SELECT username, display_name, email, global_role, is_active,
               source_system, last_login_at, created_at,
               (password_hash = $1) AS invite_pending
        FROM core_users
        ORDER BY username
        """,
        INVITE_PENDING_HASH,
    )
    return {"schema": "datasnare-core/user-list-v1", "users": [_user_payload(row) for row in rows]}


@router.post("", status_code=201)
async def create_user(body: UserCreateRequest, request: Request):
    await _require_platform_admin(request)
    username = body.username.strip()
    role = _validate_role(body.global_role)
    password_hash = _hash_password(body.password) if body.password else INVITE_PENDING_HASH

    existing = await request.app.state.database_pool.fetchval(
        "SELECT 1 FROM core_users WHERE username = $1", username
    )
    if existing:
        raise HTTPException(status_code=409, detail="A user with that username already exists")

    row = await request.app.state.database_pool.fetchrow(
        """
        INSERT INTO core_users
            (username, password_hash, display_name, email, global_role, is_active, source_system)
        VALUES ($1, $2, $3, $4, $5, TRUE, 'core')
        RETURNING username, display_name, email, global_role, is_active,
                  source_system, last_login_at, created_at,
                  (password_hash = $2) AS invite_pending
        """,
        username, password_hash, body.display_name, body.email, role,
    )
    return _user_payload(row)


@router.patch("/{username}")
async def update_user(username: str, body: UserUpdateRequest, request: Request):
    actor = await _require_platform_admin(request)
    pool = request.app.state.database_pool

    if body.is_active is False and username == actor:
        raise HTTPException(status_code=400, detail="You cannot deactivate the currently signed-in user")

    updates: dict[str, object] = {}
    if body.password is not None:
        updates["password_hash"] = _hash_password(body.password)
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.email is not None:
        updates["email"] = body.email
    if body.global_role is not None:
        updates["global_role"] = _validate_role(body.global_role)
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if not updates:
        raise HTTPException(status_code=400, detail="No supported fields were provided")

    assignments = ", ".join(f"{column} = ${index}" for index, column in enumerate(updates, start=1))
    values = [*updates.values(), username]
    row = await pool.fetchrow(
        f"""
        UPDATE core_users
        SET {assignments}, updated_at = NOW()
        WHERE username = ${len(values)}
        RETURNING username, display_name, email, global_role, is_active,
                  source_system, last_login_at, created_at,
                  (password_hash = '{INVITE_PENDING_HASH}') AS invite_pending
        """,
        *values,
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    # A password change or deactivation must not leave existing sessions usable.
    if "password_hash" in updates or updates.get("is_active") is False:
        await pool.execute(
            "UPDATE core_auth_sessions SET revoked_at = NOW() WHERE username = $1 AND revoked_at IS NULL",
            username,
        )
    return _user_payload(row)


@router.delete("/{username}")
async def delete_user(username: str, request: Request):
    actor = await _require_platform_admin(request)
    if username == actor:
        raise HTTPException(status_code=400, detail="You cannot delete the currently signed-in user")

    deleted = await request.app.state.database_pool.fetchval(
        "DELETE FROM core_users WHERE username = $1 RETURNING username", username
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "deleted", "username": deleted}


@router.post("/{username}/password-setup-token", status_code=201)
async def issue_password_setup_token(username: str, body: PasswordSetupTokenRequest, request: Request):
    """Issue a single-use setup link. Delivery is handled by the calling product."""
    actor = await _require_platform_admin(request)
    pool = request.app.state.database_pool

    user = await pool.fetchrow(
        "SELECT username, display_name, email FROM core_users WHERE username = $1 AND is_active = TRUE",
        username,
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    recipient_email = (body.email or user["email"] or "").strip()
    if not recipient_email:
        raise HTTPException(status_code=400, detail="A recipient email is required to issue a setup link")

    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours)

    # Superseding outstanding links keeps only one usable invitation per user.
    await pool.execute(
        "UPDATE core_password_setup_tokens SET consumed_at = NOW() WHERE username = $1 AND consumed_at IS NULL",
        username,
    )
    await pool.execute(
        """
        INSERT INTO core_password_setup_tokens (token_hash, username, email, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        """,
        hashlib.sha256(raw_token.encode()).hexdigest(), username, recipient_email, actor, expires_at,
    )
    await pool.execute(
        "UPDATE core_users SET email = $2, updated_at = NOW() WHERE username = $1",
        username, recipient_email,
    )

    return {
        "username": user["username"],
        "display_name": user["display_name"] or user["username"],
        "recipient_email": recipient_email,
        "token": raw_token,
        "expires_at": expires_at.isoformat(),
    }
