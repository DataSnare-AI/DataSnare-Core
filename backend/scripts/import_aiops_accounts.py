from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

import asyncpg

IDENTITY_ISSUER = "datasnare-core-local"
PRODUCT_KEY = "aiops"
ROLE_PRIORITY = {"viewer": 1, "operator": 2, "approver": 3, "tenant_admin": 4, "platform_admin": 5}


def endpoint_summary(database_url: str) -> str:
    try:
        parsed = urlsplit(database_url)
        hostname = parsed.hostname or "<missing-host>"
        port = parsed.port or 5432
        database = parsed.path.lstrip("/") or "<missing-database>"
        return f"{hostname}:{port}/{database}"
    except ValueError:
        return "<invalid database URL>"


def connection_error_message(label: str, database_url: str, error: Exception) -> str:
    endpoint = endpoint_summary(database_url)
    if isinstance(error, socket.gaierror):
        return (
            f"Could not resolve the {label} database host for {endpoint}. Check the hostname in the "
            "database URL and confirm DNS/VPN/private-endpoint access from this machine."
        )
    if isinstance(error, (TimeoutError, asyncio.TimeoutError)):
        return f"Timed out connecting to the {label} database at {endpoint}. Check network access and firewall rules."
    if isinstance(error, asyncpg.InvalidPasswordError):
        return f"The {label} database rejected the configured credentials for {endpoint}. Check the username/password."
    if isinstance(error, asyncpg.InvalidCatalogNameError):
        return f"The {label} database '{endpoint}' does not exist or is not accessible to this user."
    return f"Could not connect to the {label} database at {endpoint} ({type(error).__name__}). Check its URL and network access."


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def prepare_snapshot(tenant_rows, plan_rows, membership_rows, user_rows=()) -> dict[str, list[dict]]:
    tenants = []
    for row in tenant_rows:
        tenant = dict(row)
        tenant_id = int(tenant["tenant_id"])
        metadata = {
            key: _json_value(value)
            for key, value in tenant.items()
            if key not in {"tenant_id", "tenant_name", "display_name", "account_status", "plan_key", "plan_name", "plan_description", "plan_max_users", "plan_max_systems", "price_monthly", "status", "effective_start_date", "effective_end_date", "override_max_users", "override_max_systems"}
        }
        tenants.append({
            "tenant_id": tenant_id,
            "display_name": tenant.get("display_name") or tenant.get("tenant_name") or f"Tenant {tenant_id}",
            "status": tenant.get("account_status") or "active",
            "source_system": "aiops",
            "source_tenant_key": str(tenant_id),
            "metadata": metadata,
            "entitlement": {
                "plan_key": tenant.get("plan_key"),
                "plan_name": tenant.get("plan_name"),
                "plan_description": tenant.get("plan_description"),
                "plan_max_users": tenant.get("plan_max_users"),
                "plan_max_systems": tenant.get("plan_max_systems"),
                "price_monthly": tenant.get("price_monthly"),
                "status": tenant.get("status") or tenant.get("account_status") or "active",
                "effective_start_date": tenant.get("effective_start_date"),
                "effective_end_date": tenant.get("effective_end_date"),
                "override_max_users": tenant.get("override_max_users"),
                "override_max_systems": tenant.get("override_max_systems"),
            },
        })

    plans = []
    for row in plan_rows:
        plan = dict(row)
        plans.append({
            "product_key": PRODUCT_KEY,
            "plan_key": str(plan["plan_key"]),
            "display_name": plan["display_name"],
            "description": plan.get("description"),
            "price_monthly": plan.get("price_monthly"),
            "currency": "USD",
            "entitlements": json.dumps({
                "max_users": plan.get("max_users"),
                "max_systems": plan.get("max_systems"),
            }),
            "is_active": bool(plan.get("is_active", True)),
        })

    roles_by_membership = defaultdict(set)
    for row in membership_rows:
        membership = dict(row)
        tenant_id = int(membership["tenant_id"])
        username = str(membership["username"])
        role = str(membership["role_key"] or "viewer").strip().lower()
        if role not in ROLE_PRIORITY:
            role = "viewer"
        roles_by_membership[(tenant_id, username)].add(role)
    memberships = []
    role_conflicts = []
    for (tenant_id, username), roles in sorted(roles_by_membership.items()):
        if "platform_admin" in roles:
            role = "platform_admin"
        elif "tenant_admin" in roles:
            role = "tenant_admin"
        elif "operator" in roles and roles <= {"operator", "viewer"}:
            role = "operator"
        elif "approver" in roles and roles <= {"approver", "viewer"}:
            role = "approver"
        elif len(roles) == 1:
            role = next(iter(roles))
        else:
            role_conflicts.append({"tenant_id": tenant_id, "username": username, "roles": sorted(roles)})
            role = max(roles, key=lambda item: ROLE_PRIORITY[item])
        memberships.append({
            "tenant_id": tenant_id,
            "identity_issuer": IDENTITY_ISSUER,
            "identity_subject": username,
            "actor_id": username,
            "role_key": role,
        })
    users = []
    for row in user_rows:
        user = dict(row)
        users.append({
            "username": str(user["username"]),
            "password_hash": str(user.get("password_hash") or "!invite-pending!"),
            "display_name": user.get("display_name") or user.get("actor_name"),
            "email": user.get("email"),
            "global_role": user.get("global_role") or user.get("role") or "viewer",
            "is_active": bool(user.get("is_active", True)),
        })
    return {"tenants": tenants, "plans": plans, "memberships": memberships, "users": users, "role_conflicts": role_conflicts}


async def read_aiops_snapshot(pool) -> dict[str, list[dict]]:
    tenant_rows = await pool.fetch(
        """
        SELECT
            t.id AS tenant_id,
            t.tenant_name,
            COALESCE(t.display_name, t.tenant_name) AS display_name,
            COALESCE(t.account_status, 'active') AS account_status,
            t.company_name,
            t.primary_address,
            t.phone,
            t.email,
            t.primary_contact_name,
            t.billing_contact_email,
            t.billing_contact_name,
            t.contract_start_date,
            t.contract_end_date,
            t.notes,
            ts.plan_key,
            sp.display_name AS plan_name,
            sp.description AS plan_description,
            sp.max_users AS plan_max_users,
            sp.max_systems AS plan_max_systems,
            sp.price_monthly,
            COALESCE(ts.status, t.account_status, 'active') AS status,
            ts.effective_start_date,
            ts.effective_end_date,
            ts.override_max_users,
            ts.override_max_systems
        FROM tenants t
        LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
        LEFT JOIN subscription_plans sp ON sp.plan_key = ts.plan_key
        ORDER BY t.id
        """
    )
    plan_rows = await pool.fetch(
        "SELECT plan_key, display_name, description, max_users, max_systems, price_monthly, is_active FROM subscription_plans ORDER BY plan_key"
    )
    user_rows = await pool.fetch(
        """
        SELECT username, password_hash, actor_name, email, role, is_active
        FROM app_users
        ORDER BY username
        """
    )
    membership_rows = await pool.fetch(
        """
        SELECT tur.tenant_id, u.username, tur.role_key
        FROM tenant_user_roles tur
        JOIN app_users u ON u.username = tur.username
        JOIN tenants t ON t.id = tur.tenant_id
        WHERE COALESCE(u.is_active, TRUE) = TRUE
        UNION ALL
        SELECT put.tenant_id, u.username,
            CASE WHEN COALESCE(put.can_manage, FALSE) THEN 'tenant_admin' ELSE 'viewer' END AS role_key
        FROM platform_user_tenants put
        JOIN app_users u ON u.username = put.username
        JOIN tenants t ON t.id = put.tenant_id
        WHERE COALESCE(u.is_active, TRUE) = TRUE
        UNION ALL
        SELECT t.id AS tenant_id, u.username, 'platform_admin' AS role_key
        FROM app_users u
        CROSS JOIN tenants t
        WHERE u.role = 'platform_admin' AND COALESCE(u.is_active, TRUE) = TRUE
        ORDER BY tenant_id, username
        """
    )
    return prepare_snapshot(tenant_rows, plan_rows, membership_rows, user_rows)


async def apply_snapshot(pool, snapshot: dict[str, list[dict]]) -> None:
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(
                "UPDATE core_tenant_memberships SET status = 'inactive', updated_at = NOW() WHERE identity_issuer = $1",
                IDENTITY_ISSUER,
            )
            await connection.execute(
                "UPDATE core_tenant_product_entitlements SET status = 'inactive', updated_at = NOW() WHERE source_system = 'aiops' AND product_key = $1",
                PRODUCT_KEY,
            )
            await connection.execute(
                "UPDATE core_tenants SET status = 'inactive', updated_at = NOW() WHERE source_system = 'aiops'"
            )
            await connection.execute(
                "UPDATE core_users SET is_active = FALSE, updated_at = NOW() WHERE source_system = 'aiops'"
            )

            for user in snapshot["users"]:
                await connection.execute(
                    """
                    INSERT INTO core_users
                        (username, password_hash, display_name, email, global_role, is_active, source_system, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'aiops', NOW())
                    ON CONFLICT (username) DO UPDATE SET
                        password_hash = EXCLUDED.password_hash,
                        display_name = EXCLUDED.display_name,
                        email = EXCLUDED.email,
                        global_role = EXCLUDED.global_role,
                        is_active = EXCLUDED.is_active,
                        source_system = 'aiops',
                        updated_at = NOW()
                    """,
                    user["username"], user["password_hash"], user["display_name"], user["email"],
                    user["global_role"], user["is_active"],
                )

            for tenant in snapshot["tenants"]:
                await connection.execute(
                    """
                    INSERT INTO core_tenants
                        (tenant_id, display_name, status, source_system, source_tenant_key, metadata, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
                    ON CONFLICT (tenant_id) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        status = EXCLUDED.status,
                        source_system = EXCLUDED.source_system,
                        source_tenant_key = EXCLUDED.source_tenant_key,
                        metadata = EXCLUDED.metadata,
                        updated_at = NOW()
                    """,
                    tenant["tenant_id"], tenant["display_name"], tenant["status"], tenant["source_system"],
                    tenant["source_tenant_key"], json.dumps(tenant["metadata"]),
                )

            for plan in snapshot["plans"]:
                await connection.execute(
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
                    """,
                    plan["product_key"], plan["plan_key"], plan["display_name"], plan["description"],
                    plan["price_monthly"], plan["currency"], plan["entitlements"], plan["is_active"],
                )

            for tenant in snapshot["tenants"]:
                entitlement = tenant["entitlement"]
                plan_key = entitlement["plan_key"]
                if not plan_key:
                    continue
                limits_override = {
                    key: value for key, value in {
                        "max_users": entitlement["override_max_users"],
                        "max_systems": entitlement["override_max_systems"],
                    }.items() if value is not None
                }
                await connection.execute(
                    """
                    INSERT INTO core_tenant_product_entitlements
                        (tenant_id, product_key, plan_key, status, effective_start_date, effective_end_date,
                         limits_override, source_system, source_record_key, metadata, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'aiops', $8, $9::jsonb, NOW())
                    ON CONFLICT (tenant_id, product_key) DO UPDATE SET
                        plan_key = EXCLUDED.plan_key,
                        status = EXCLUDED.status,
                        effective_start_date = EXCLUDED.effective_start_date,
                        effective_end_date = EXCLUDED.effective_end_date,
                        limits_override = EXCLUDED.limits_override,
                        source_system = EXCLUDED.source_system,
                        source_record_key = EXCLUDED.source_record_key,
                        metadata = EXCLUDED.metadata,
                        updated_at = NOW()
                    """,
                    tenant["tenant_id"], PRODUCT_KEY, plan_key, entitlement["status"],
                    entitlement["effective_start_date"], entitlement["effective_end_date"],
                    json.dumps(limits_override), tenant["source_tenant_key"],
                    json.dumps({"import_source": "aiops", "migration": "account-import-v1"}),
                )

            for membership in snapshot["memberships"]:
                await connection.execute(
                    """
                    INSERT INTO core_tenant_memberships
                        (tenant_id, identity_issuer, identity_subject, actor_id, role_key, status, updated_at)
                    VALUES ($1, $2, $3, $4, $5, 'active', NOW())
                    ON CONFLICT (tenant_id, identity_issuer, identity_subject) DO UPDATE SET
                        actor_id = EXCLUDED.actor_id,
                        role_key = EXCLUDED.role_key,
                        status = 'active',
                        updated_at = NOW()
                    """,
                    membership["tenant_id"], membership["identity_issuer"], membership["identity_subject"],
                    membership["actor_id"], membership["role_key"],
                )


async def run(apply: bool) -> int:
    aiops_url = os.getenv("AIOPS_DATABASE_URL", "").strip()
    core_url = os.getenv("CORE_DATABASE_URL", "").strip()
    if not aiops_url or not core_url:
        raise RuntimeError("Set AIOPS_DATABASE_URL and CORE_DATABASE_URL; neither value is printed or logged")
    if aiops_url == core_url:
        raise RuntimeError("AIOPS_DATABASE_URL and CORE_DATABASE_URL must point to separate databases")

    source = None
    target = None
    try:
        try:
            source = await asyncpg.create_pool(aiops_url, min_size=1, max_size=2)
        except Exception as error:
            raise RuntimeError(connection_error_message("AIOps source", aiops_url, error)) from None
        try:
            target = await asyncpg.create_pool(core_url, min_size=1, max_size=2)
        except Exception as error:
            raise RuntimeError(connection_error_message("Core target", core_url, error)) from None

        snapshot = await read_aiops_snapshot(source)
        print(f"Snapshot: {len(snapshot['users'])} users, {len(snapshot['tenants'])} tenants, {len(snapshot['memberships'])} memberships, {len(snapshot['plans'])} AIOps plans")
        if snapshot["role_conflicts"]:
            print(f"Role conflicts: {len(snapshot['role_conflicts'])} users have multiple tenant roles; see the conflict list before applying.")
            for conflict in snapshot["role_conflicts"][:50]:
                print(f"  tenant={conflict['tenant_id']} user={conflict['username']} roles={','.join(conflict['roles'])}")
        print("Password hashes are copied unchanged; plaintext passwords are never selected or transferred.")
        print("Membership identity issuer: datasnare-core-local (username subjects can later be linked to OIDC subjects).")
        if not apply:
            print("Dry run only. No Core rows changed. Review the counts, then rerun with --apply to replace the aiops-sourced snapshot.")
            return 0
        if snapshot["role_conflicts"]:
            raise RuntimeError("Import stopped: resolve multi-role memberships before applying; no Core rows were changed")
        await apply_snapshot(target, snapshot)
        print("Import committed. Re-run without --apply for a read-only source snapshot review.")
        return 0
    finally:
        if source is not None:
            await source.close()
        if target is not None:
            await target.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Import AIOps tenant memberships and current plans into the Core account catalog.")
    parser.add_argument("--apply", action="store_true", help="Apply the reviewed snapshot to Core. Without this flag the importer is read-only.")
    args = parser.parse_args()
    return asyncio.run(run(args.apply))


if __name__ == "__main__":
    raise SystemExit(main())
