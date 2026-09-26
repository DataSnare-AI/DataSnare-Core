import pathlib
import sys
from datetime import datetime, timezone

import asyncio


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts.knowledge import KnowledgeItem, KnowledgeProvenance
from app.repositories.postgres_knowledge_items import PostgresKnowledgeItemRepository


class FakeDb:
    def __init__(self):
        self.executed = []
        self.rows = []

    async def execute(self, query, *args):
        self.executed.append((query, args))

    async def fetch(self, query, *args):
        return self.rows


def test_postgres_repository_writes_provenance_and_maps_rows():
    async def scenario():
        db = FakeDb()
        repository = PostgresKnowledgeItemRepository(db)
        observed_at = datetime(2026, 9, 25, tzinfo=timezone.utc)
        item = KnowledgeItem(
            tenant_id=7,
            item_id="knowledge-1",
            item_type="alert",
            title="Database alert",
            text="Latency exceeded threshold",
            metadata={"classification": "internal"},
            provenance=KnowledgeProvenance(source_type="alert", source_id="alert-1", agent_id="agent-7", observed_at=observed_at),
        )

        saved = await repository.create(item)
        db.rows = [{
            "tenant_id": 7, "item_id": "knowledge-1", "item_type": "alert", "title": "Database alert",
            "content": "Latency exceeded threshold", "metadata": {"classification": "internal"},
            "source_type": "alert", "source_id": "alert-1", "source_name": None,
            "agent_id": "agent-7", "site_id": None, "area_id": None, "observed_at": observed_at,
        }]
        listed = await repository.list_for_tenant(7)

        assert saved.item_id == "knowledge-1"
        assert len(db.executed) == 1
        assert db.executed[0][1][0] == 7
        assert listed[0].provenance.agent_id == "agent-7"
        assert listed[0].provenance.observed_at == observed_at

    asyncio.run(scenario())