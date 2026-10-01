import pathlib
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routes.admin_tenants import _serialize, router


class FakeTenantPool:
    def __init__(self, *, exists=1, rows=None, row=None, values=None):
        self.exists = exists
        self.rows = rows or []
        self.row = row
        self.values = list(values or [])
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        return self.rows

    async def fetchval(self, query, *args):
        self.calls.append((query, args))
        if self.values:
            return self.values.pop(0)
        return self.exists

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return self.row


class FakeProvider:
    def __init__(self, role="platform_admin"):
        self.role = role

    async def profile(self, authorization: str):
        return {"username": "admin", "actor_id": "admin", "role": self.role}


def build_client(pool, role="platform_admin"):
    app = FastAPI()
    app.state.auth_provider = FakeProvider(role)
    app.state.database_pool = pool
    app.include_router(router)
    return TestClient(app)


AUTH = {"Authorization": "Bearer session"}


def test_admin_serializer_decodes_jsonb_limit_fields():
    payload = _serialize({"entitlements": '{"max_users":10}', "limits_override": '{"max_systems":20}'})

    assert payload["entitlements"] == {"max_users": 10}
    assert payload["limits_override"] == {"max_systems": 20}


def test_tenant_administration_requires_platform_admin():
    client = build_client(FakeTenantPool(), role="tenant_admin")

    assert client.get("/api/admin/tenants", headers=AUTH).status_code == 403


def test_onboard_tenant_persists_required_and_optional_account_details():
    pool = FakeTenantPool(
        values=[None, 27],
        row={
            "tenant_id": 27, "tenant_name": "acme", "display_name": "acme", "company_name": "Acme Inc",
            "primary_address": "1 Main St", "phone": "+1 555 0100", "contact_email": "ops@acme.test",
            "primary_contact_name": "Alex", "billing_contact_name": "Pat", "billing_contact_email": "billing@acme.test",
            "max_users": 12, "max_systems": 80, "contract_start_date": None, "contract_end_date": None,
            "notes": "Managed account", "status": "active", "source_system": "core", "created_at": None,
        },
    )
    client = build_client(pool)

    response = client.post(
        "/api/admin/tenants",
        headers=AUTH,
        json={
            "tenant_name": "acme", "company_name": "Acme Inc", "primary_address": "1 Main St",
            "phone": "+1 555 0100", "contact_email": "ops@acme.test", "primary_contact_name": "Alex",
            "billing_contact_name": "Pat", "billing_contact_email": "billing@acme.test",
            "max_users": 12, "max_systems": 80, "notes": "Managed account",
        },
    )

    assert response.status_code == 201
    args = next(args for query, args in pool.calls if "INSERT INTO core_tenants" in query)
    assert args[1:4] == ("acme", "acme", "Acme Inc")
    assert args[10:12] == (12, 80)
    assert args[14] == "Managed account"


def test_onboard_tenant_requires_company_name():
    client = build_client(FakeTenantPool())

    response = client.post("/api/admin/tenants", headers=AUTH, json={"tenant_name": "acme"})

    assert response.status_code == 422


def test_onboard_tenant_rejects_contract_end_before_start():
    client = build_client(FakeTenantPool())

    response = client.post(
        "/api/admin/tenants",
        headers=AUTH,
        json={
            "tenant_name": "acme", "company_name": "Acme Inc", "max_users": 10, "max_systems": 50,
            "contract_start_date": "2026-10-10", "contract_end_date": "2026-10-01",
        },
    )

    assert response.status_code == 400


def test_assigning_an_unknown_plan_is_rejected():
    pool = FakeTenantPool(exists=None)
    client = build_client(pool)

    response = client.put(
        "/api/admin/tenants/7/entitlements",
        headers=AUTH,
        json={"product_key": "aiops", "plan_key": "nonexistent"},
    )

    assert response.status_code == 404


def test_entitlement_assignment_records_limit_overrides():
    pool = FakeTenantPool(
        exists=1,
        row={
            "tenant_id": 7, "product_key": "aiops", "plan_key": "growth", "status": "active",
            "effective_start_date": None, "effective_end_date": None,
            "limits_override": {"max_users": 75}, "source_system": "core",
        },
    )
    client = build_client(pool)

    response = client.put(
        "/api/admin/tenants/7/entitlements",
        headers=AUTH,
        json={"product_key": "aiops", "plan_key": "growth", "max_users": 75},
    )

    assert response.status_code == 200
    insert_args = next(args for query, args in pool.calls if "INSERT INTO core_tenant_product_entitlements" in query)
    assert '"max_users": 75' in insert_args[6]


def test_membership_role_must_be_supported():
    client = build_client(FakeTenantPool())

    response = client.put(
        "/api/admin/tenants/7/members",
        headers=AUTH,
        json={"actor_id": "alice", "role_key": "superuser"},
    )

    assert response.status_code == 400


def test_membership_requires_existing_user():
    pool = FakeTenantPool(exists=None)
    client = build_client(pool)

    response = client.put(
        "/api/admin/tenants/7/members",
        headers=AUTH,
        json={"actor_id": "ghost", "role_key": "operator"},
    )

    assert response.status_code == 404


def test_removing_membership_deactivates_rather_than_deleting():
    pool = FakeTenantPool(row={"tenant_id": 7, "actor_id": "alice", "role_key": "operator", "status": "inactive"})
    client = build_client(pool)

    response = client.delete("/api/admin/tenants/7/members/alice", headers=AUTH)

    assert response.status_code == 200
    assert response.json()["status"] == "inactive"
    assert any("SET status = 'inactive'" in query for query, _ in pool.calls)


def test_revoking_entitlement_keeps_the_record_for_audit():
    pool = FakeTenantPool(row={"tenant_id": 7, "product_key": "aiops", "plan_key": "growth", "status": "revoked"})
    client = build_client(pool)

    response = client.delete("/api/admin/tenants/7/entitlements/aiops", headers=AUTH)

    assert response.status_code == 200
    assert response.json()["status"] == "revoked"
    assert not any("DELETE FROM core_tenant_product_entitlements" in query for query, _ in pool.calls)


def test_plan_upsert_requires_a_known_product():
    pool = FakeTenantPool(exists=None)
    client = build_client(pool)

    response = client.put(
        "/api/admin/catalog/unknown/plans/growth",
        headers=AUTH,
        json={"display_name": "Growth"},
    )

    assert response.status_code == 404


def test_plan_upsert_stores_limits_as_entitlements():
    pool = FakeTenantPool(
        exists=1,
        row={
            "product_key": "aiops", "plan_key": "scale", "display_name": "Scale",
            "description": None, "price_monthly": "899.00", "currency": "USD",
            "entitlements": {"max_users": 120}, "is_active": True,
        },
    )
    client = build_client(pool)

    response = client.put(
        "/api/admin/catalog/aiops/plans/scale",
        headers=AUTH,
        json={"display_name": "Scale", "price_monthly": 899, "max_users": 120, "max_systems": 600},
    )

    assert response.status_code == 200
    args = next(args for query, args in pool.calls if "INSERT INTO core_product_plans" in query)
    assert '"max_users": 120' in args[6]
    assert '"max_systems": 600' in args[6]
