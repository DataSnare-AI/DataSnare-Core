import asyncio
import pathlib
import sys
from datetime import datetime, timezone


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts.knowledge_graph import KnowledgeEdge
from app.repositories.postgres_knowledge_graph import PostgresKnowledgeGraphRepository
from app.repositories.postgres_retrieval_audit import PostgresRetrievalAuditRepository
from app.repositories.retrieval_audit import RetrievalAuditEvent


class FakeDatabase:
    def __init__(self):
        self.execute_calls = []
        self.fetch_calls = []
        self.graph_rows = []
        self.audit_rows = []

    async def execute(self, query, *args):
        self.execute_calls.append((query, args))

    async def fetch(self, query, *args):
        self.fetch_calls.append((query, args))
        if "knowledge_graph_edges" in query:
            return self.graph_rows
        return self.audit_rows


def test_postgres_graph_and_audit_repositories_are_tenant_scoped():
    async def scenario():
        database = FakeDatabase()
        observed_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
        edge = KnowledgeEdge(
            tenant_id=17,
            edge_id="edge-a",
            subject_type="alert",
            subject_id="alert-a",
            predicate="caused_by",
            object_type="service",
            object_id="service-a",
            observed_at=observed_at,
            metadata={"source": "test"},
        )
        edge_row = {
            "tenant_id": edge.tenant_id,
            "edge_id": edge.edge_id,
            "subject_type": edge.subject_type,
            "subject_id": edge.subject_id,
            "predicate": edge.predicate,
            "object_type": edge.object_type,
            "object_id": edge.object_id,
            "observed_at": edge.observed_at,
            "metadata": edge.metadata,
        }
        database.graph_rows = [edge_row]
        graph = PostgresKnowledgeGraphRepository(database)

        assert await graph.add_edge(edge) == edge
        assert database.execute_calls[0][1][:2] == (17, "edge-a")
        assert database.execute_calls[0][1][-1] == '{"source":"test"}'
        listed_edges = await graph.list_edges(17)
        assert listed_edges == [edge]
        assert database.fetch_calls[-1][1] == (17,)
        path = await graph.find_path(17, "alert", "alert-a", "service", "service-a")
        assert path == [edge]
        assert database.fetch_calls[-1][1] == (17,)

        event = RetrievalAuditEvent(
            tenant_id=17,
            actor_id="operator@example.com",
            retrieval_id="retrieval-a",
            status="indexed",
            routed_agent_ids=("agent-a",),
            metadata={"result_count": 1},
            event_id="audit-a",
            created_at=observed_at,
        )
        database.audit_rows = [{
            "tenant_id": event.tenant_id,
            "event_id": event.event_id,
            "retrieval_id": event.retrieval_id,
            "actor_id": event.actor_id,
            "status": event.status,
            "routed_agent_ids": ["agent-a"],
            "metadata": event.metadata,
            "created_at": event.created_at,
        }]
        audit = PostgresRetrievalAuditRepository(database)
        assert await audit.append(event) == event
        assert database.execute_calls[-1][1][:5] == (17, "audit-a", "retrieval-a", "operator@example.com", "indexed")
        assert database.execute_calls[-1][1][5:7] == ('["agent-a"]', '{"result_count":1}')
        listed_events = await audit.list_for_tenant(17)
        assert database.fetch_calls[-1][1] == (17,)
        assert listed_events == [event]

    asyncio.run(scenario())
