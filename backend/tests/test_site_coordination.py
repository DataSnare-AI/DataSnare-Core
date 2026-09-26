import asyncio
import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.repositories.site_cache import InMemorySiteQueryCache
from app.services.site_coordination import build_site_query_plan


def test_site_query_plan_has_stable_normalized_cache_key():
    first = build_site_query_plan(7, "site-east", "find database alerts", area_ids=("db", "web", "db"), top_k=5)
    second = build_site_query_plan(7, "site-east", "find database alerts", area_ids=("web", "db"), top_k=5)

    assert first.area_ids == ("db", "web")
    assert first.cache_key == second.cache_key


def test_site_cache_is_tenant_scoped_and_expires():
    async def scenario():
        cache = InMemorySiteQueryCache(ttl_seconds=0)
        await cache.set(7, "site:key", {"results": [1]})
        assert await cache.get(8, "site:key") is None
        assert await cache.get(7, "site:key") is None

    asyncio.run(scenario())