import pathlib
import sys
from datetime import datetime, timezone


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts.agent_manifest import AgentManifest
from app.repositories.postgres_agent_manifests import PostgresAgentManifestRepository


class FakeDatabase:
    def __init__(self):
        self.execute_args = None
        self.fetch_args = None
        self.fetchrow_args = None
        self.row = {
            "tenant_id": 17,
            "agent_id": "agent-a",
            "system_name": "host-a",
            "site_id": "site-a",
            "area_id": "ops",
            "capabilities": ["telemetry"],
            "knowledge_types": ["alerts"],
            "status": "online",
            "last_seen_at": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "metadata": {"region": "east"},
        }

    async def execute(self, query, *args):
        self.execute_args = (query, args)

    async def fetch(self, query, *args):
        self.fetch_args = (query, args)
        return [self.row]

    async def fetchrow(self, query, *args):
        self.fetchrow_args = (query, args)
        return self.row if args == (17, "agent-a") else None


def test_postgres_agent_manifest_repository_scopes_and_maps_records():
    import asyncio

    async def scenario():
        database = FakeDatabase()
        repository = PostgresAgentManifestRepository(database)
        manifest = AgentManifest(
            tenant_id=17,
            agent_id="agent-a",
            system_name="host-a",
            site_id="site-a",
            area_id="ops",
            capabilities=["telemetry"],
            knowledge_types=["alerts"],
            status="online",
            last_seen_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
            metadata={"region": "east"},
        )

        assert await repository.upsert(manifest) == manifest
        persisted_parameters = database.execute_args[1]
        assert persisted_parameters[:2] == (17, "agent-a")
        assert persisted_parameters[5:7] == ('["telemetry"]', '["alerts"]')
        assert persisted_parameters[9] == '{"region":"east"}'

        listed = await repository.list_for_tenant(17)
        assert database.fetch_args[1] == (17,)
        assert listed[0].metadata == {"region": "east"}
        assert listed[0].last_seen_at == manifest.last_seen_at

        found = await repository.get(17, "agent-a")
        assert database.fetchrow_args[1] == (17, "agent-a")
        assert found == manifest
        assert await repository.get(18, "agent-a") is None

    asyncio.run(scenario())
