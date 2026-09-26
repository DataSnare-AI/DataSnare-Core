import pathlib
import sys


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts.agent_manifest import AgentManifest
from app.services.routing import route_query


def test_route_query_selects_online_agents_by_scope_and_knowledge_type():
    manifests = [
        AgentManifest(tenant_id=7, agent_id="agent-a", system_name="a", site_id="east", area_id="db", knowledge_types=["alerts"], status="online"),
        AgentManifest(tenant_id=7, agent_id="agent-b", system_name="b", site_id="east", area_id="web", knowledge_types=["runbooks"], status="online"),
        AgentManifest(tenant_id=7, agent_id="agent-c", system_name="c", site_id="east", area_id="db", knowledge_types=["alerts"], status="offline"),
    ]

    route = route_query(manifests, site_id="east", area_id="db", item_types=["alerts"])

    assert route.agent_ids == ("agent-a",)
    assert route.reason == "matched manifest filters"


def test_route_query_can_target_one_agent_and_reports_empty_route():
    manifest = AgentManifest(tenant_id=7, agent_id="agent-a", system_name="a", status="online")

    assert route_query([manifest], agent_id="agent-b").agent_ids == ()