import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts.knowledge_graph import KnowledgeEdge
from app.services.graph_query import related_edges


def test_related_edges_traverses_typed_neighbors():
    edges = [
        KnowledgeEdge(tenant_id=7, subject_type="alert", subject_id="a1", predicate="caused_by", object_type="service", object_id="svc1"),
        KnowledgeEdge(tenant_id=7, subject_type="service", subject_id="svc1", predicate="runs_on", object_type="device", object_id="dev1"),
    ]

    related = related_edges(edges, entity_type="alert", entity_id="a1", max_hops=2)

    assert [edge.object_id for edge in related] == ["svc1", "dev1"]


def test_related_edges_rejects_unknown_entity_type():
    assert related_edges([], entity_type="unknown", entity_id="x") == []