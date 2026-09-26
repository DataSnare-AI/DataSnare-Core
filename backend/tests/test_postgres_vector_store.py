import asyncio
import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.postgres_vector_store import PostgresVectorStore
from app.services.vector_store import VectorDocument


class FakeDb:
    def __init__(self):
        self.executed = []
        self.rows = []

    async def execute(self, query, *args):
        self.executed.append((query, args))

    async def fetch(self, query, *args):
        self.executed.append((query, args))
        return self.rows


def test_pgvector_store_serializes_vectors_and_scopes_search():
    async def scenario():
        db = FakeDb()
        store = PostgresVectorStore(db)
        document = VectorDocument(7, "chunk-1", "database alert", (0.5, 0.5), {"agent_id": "agent-7", "knowledge_item_id": "item-1"})
        await store.upsert(document)
        db.rows = [{"tenant_id": 7, "chunk_id": "chunk-1", "content": "database alert", "metadata": {"agent_id": "agent-7"}}]
        results = await store.search(7, (0.5, 0.5), top_k=3, agent_ids=("agent-7",))

        assert results[0].item_id == "chunk-1"
        assert db.executed[0][1][8] == "[0.5,0.5]"
        search_args = db.executed[1][1]
        assert search_args[0] == 7
        assert search_args[2] == ["agent-7"]

    asyncio.run(scenario())