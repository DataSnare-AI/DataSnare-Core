import pathlib
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.repositories.product_accounts import InMemoryProductAccountRepository, PostgresProductAccountRepository
from app.routes.auth import router


class FakeAuthProvider:
    async def profile(self, authorization: str):
        assert authorization == "Bearer test-session"
        return {
            "username": "alice",
            "display_name": "Alice",
            "tenant_subscriptions": [{"tenant_id": 19, "plan_key": "old-aiops-value"}],
        }


class FakeProductAccountRepository(InMemoryProductAccountRepository):
    async def list_for_actor(self, actor_id: str):
        assert actor_id == "alice"
        return [
            {
                "tenant_id": 19,
                "tenant_name": "Northwind",
                "role_key": "tenant_admin",
                "product_key": "aiops",
                "product_name": "DataSnare AIOps",
                "plan_key": "growth",
                "plan_name": "Growth",
                "price_monthly": "399.00",
                "currency": "USD",
                "entitlements": {"max_users": 50, "max_systems": 250},
                "entitlement_status": "active",
                "effective_start_date": None,
                "effective_end_date": None,
                "limits_override": {},
            }
        ]


def test_account_profile_uses_core_product_entitlements():
    app = FastAPI()
    app.state.auth_provider = FakeAuthProvider()
    app.state.product_accounts = FakeProductAccountRepository()
    app.include_router(router)

    response = TestClient(app).get("/api/auth/profile", headers={"Authorization": "Bearer test-session"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["account_source"] == "core-product-catalog"
    assert payload["tenant_roles"] == {"19": ["tenant_admin"]}
    assert payload["tenant_subscriptions"] == [
        {
            "tenant_id": 19,
            "tenant_name": "Northwind",
            "product_key": "aiops",
            "product_name": "DataSnare AIOps",
            "plan": "growth",
            "plan_key": "growth",
            "plan_name": "Growth",
            "price_monthly": "399.00",
            "currency": "USD",
            "account_status": "active",
            "effective_start_date": None,
            "effective_end_date": None,
            "limits": {"users_allocated": 50, "systems_allocated": 250},
        }
    ]


def test_postgres_product_account_repository_decodes_asyncpg_jsonb_strings():
    class FakePool:
        async def fetch(self, _query, *_args):
            return [{
                "tenant_id": 19,
                "tenant_name": "Northwind",
                "role_key": "tenant_admin",
                "tenant_status": "active",
                "product_key": "aiops",
                "product_name": "DataSnare AIOps",
                "plan_key": "growth",
                "plan_name": "Growth",
                "price_monthly": "399.00",
                "currency": "USD",
                "entitlements": '{"max_users":50,"max_systems":250}',
                "entitlement_status": "active",
                "effective_start_date": None,
                "effective_end_date": None,
                "limits_override": '{}',
            }]

    import asyncio
    rows = asyncio.run(PostgresProductAccountRepository(FakePool()).list_for_actor("alice"))

    assert rows[0]["entitlements"] == {"max_users": 50, "max_systems": 250}
    assert rows[0]["limits_override"] == {}
