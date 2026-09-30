from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from fastapi import HTTPException

from app.security.authorization import ActorContext, ROLE_PERMISSIONS


class CoreIdentityProvider:
    """Core-owned username/password identity with hashed opaque bearer sessions."""

    session_ttl = timedelta(hours=8)

    def __init__(self, pool):
        self.pool = pool

    async def login(self, username: str, password: str) -> dict[str, Any]:
        normalized_username = username.strip()
        user = await self.pool.fetchrow(
            """
            SELECT username, password_hash, display_name, global_role
            FROM core_users
            WHERE username = $1 AND is_active = TRUE
            """,
            normalized_username,
        )
        if not user or not self._verify_password(password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        raw_token = secrets.token_urlsafe(48)
        expires_at = datetime.now(timezone.utc) + self.session_ttl
        await self.pool.execute(
            """
            INSERT INTO core_auth_sessions (token_hash, username, expires_at)
            VALUES ($1, $2, $3)
            """,
            hashlib.sha256(raw_token.encode()).hexdigest(),
            normalized_username,
            expires_at,
        )
        await self.pool.execute(
            "UPDATE core_users SET last_login_at = NOW(), updated_at = NOW() WHERE username = $1",
            normalized_username,
        )
        return {
            "actor": normalized_username,
            "role": user["global_role"],
            "token": raw_token,
            "username": normalized_username,
            "expires_at": expires_at.isoformat(),
        }

    async def _active_session(self, authorization: str):
        token = self._token(authorization)
        return await self.pool.fetchrow(
            """
            SELECT u.username, u.global_role, u.display_name, u.email
            FROM core_auth_sessions s
            JOIN core_users u ON u.username = s.username
            WHERE s.token_hash = $1
              AND s.revoked_at IS NULL
              AND s.expires_at > NOW()
              AND u.is_active = TRUE
            LIMIT 1
            """,
            hashlib.sha256(token.encode()).hexdigest(),
        )

    async def profile(self, authorization: str) -> dict[str, Any]:
        user = await self._active_session(authorization)
        if not user:
            raise HTTPException(status_code=401, detail="Session is invalid, expired, or revoked")
        return {
            "username": user["username"],
            "actor_id": user["username"],
            "display_name": user["display_name"] or user["username"],
            "email": user["email"],
            "role": user["global_role"],
            "is_active": True,
        }

    async def logout(self, authorization: str) -> dict[str, str]:
        token = self._token(authorization)
        await self.pool.execute(
            "UPDATE core_auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
            hashlib.sha256(token.encode()).hexdigest(),
        )
        return {"status": "logged_out"}

    async def resolve_actor(
        self,
        tenant_id: int,
        x_actor: str | None = None,
        x_role: str | None = None,
        *,
        request: Any | None = None,
        authorization: str | None = None,
    ) -> ActorContext:
        if request is not None:
            authorization = authorization or request.headers.get("authorization")
        if not authorization:
            raise HTTPException(status_code=401, detail="Bearer authentication is required")
        user = await self._active_session(authorization)
        if not user:
            raise HTTPException(status_code=401, detail="Session is invalid, expired, or revoked")

        global_role = str(user["global_role"] or "viewer").lower()
        if global_role == "platform_admin":
            role = "platform_admin"
        else:
            membership = await self.pool.fetchrow(
                """
                SELECT role_key
                FROM core_tenant_memberships
                WHERE tenant_id = $1
                  AND actor_id = $2
                  AND status = 'active'
                ORDER BY CASE role_key
                    WHEN 'tenant_admin' THEN 1
                    WHEN 'approver' THEN 2
                    WHEN 'operator' THEN 3
                    WHEN 'viewer' THEN 4
                    ELSE 5
                END
                LIMIT 1
                """,
                tenant_id,
                user["username"],
            )
            if not membership:
                raise HTTPException(status_code=403, detail="User has no access to the requested tenant")
            role = str(membership["role_key"]).lower()

        if role not in ROLE_PERMISSIONS:
            raise HTTPException(status_code=403, detail="User has an unsupported role")
        return ActorContext(actor_id=user["username"], tenant_id=tenant_id, role=role, source="core-identity")

    async def introspect(self, authorization: str, tenant_id: int) -> dict[str, Any]:
        actor = await self.resolve_actor(tenant_id, authorization=authorization)
        return {
            "schema": "datasnare-auth/identity-v1",
            "authenticated": True,
            "actor_id": actor.actor_id,
            "subject": actor.actor_id,
            "tenant_id": tenant_id,
            "role": actor.role,
            "issuer": "datasnare-core",
        }

    @staticmethod
    def _token(authorization: str) -> str:
        scheme, _, token = authorization.strip().partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise HTTPException(status_code=401, detail="Bearer authentication is required")
        return token.strip()

    @staticmethod
    def _verify_password(password: str, password_hash: str) -> bool:
        if not password or not password_hash or password_hash.startswith("!"):
            return False
        try:
            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except (ValueError, TypeError):
            return False
