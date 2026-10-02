import pathlib
import sys
import os
import tempfile

from fastapi.testclient import TestClient
from scapy.all import Ether, IP, TCP
from scapy.utils import PcapNgWriter


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app


def _sample_pcapng():
    descriptor, path = tempfile.mkstemp(suffix=".pcapng")
    os.close(descriptor)
    try:
        writer = PcapNgWriter(path)
        writer.write(Ether() / IP(src="192.0.2.10", dst="198.51.100.20") / TCP(sport=43120, dport=443, flags="R"))
        writer.close()
        return pathlib.Path(path).read_bytes()
    finally:
        pathlib.Path(path).unlink(missing_ok=True)


def test_ainetscope_upload_accepts_pcapng_and_completes_job():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post("/api/tenants/7/tools/ainetscope/jobs", headers=headers, json={"artifact_name": "capture.pcapng", "artifact_type": "pcapng"})
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(f"/api/tenants/7/tools/ainetscope/jobs/{job_id}/artifact", headers=headers, content=_sample_pcapng())

    assert uploaded.status_code == 200
    assert uploaded.json()["job"]["state"] == "completed"
    assert uploaded.json()["analysis"]["schema"] == "datasnare-ainetscope/analysis-v1"
    assert uploaded.json()["analysis"]["format"] == "pcapng"
    assert uploaded.json()["analysis"]["packets"] == 1
    assert uploaded.json()["analysis"]["flows"] == 1
    assert uploaded.json()["analysis"]["preview"][0]["category"] == "network.tcp"
    assert uploaded.json()["analysis"]["findings"][0]["title"] == "TCP resets observed"
    assert uploaded.json()["evidence"]["schema"] == "datasnare-analysis-evidence/v1"
    assert uploaded.json()["evidence"]["plugin_id"] == "ainetscope"
    assert uploaded.json()["evidence"]["findings"][0]["id"] == "tcp-resets"
    assert uploaded.json()["knowledge_item_id"]
    retrieved = client.post("/api/tenants/7/rag/retrieve", headers=headers, json={"query": "TCP reset packet", "top_k": 3})
    assert retrieved.status_code == 200
    assert any(result["provenance"]["source_id"] == job_id for result in retrieved.json()["results"])


def test_ainetscope_upload_rejects_invalid_capture_and_marks_job_failed():
    client = TestClient(create_app())
    headers = {"X-Actor": "operator@example.com", "X-Role": "operator"}
    created = client.post("/api/tenants/7/tools/ainetscope/jobs", headers=headers, json={"artifact_name": "capture.pcap", "artifact_type": "pcap"})
    job_id = created.json()["job"]["job_id"]

    uploaded = client.post(f"/api/tenants/7/tools/ainetscope/jobs/{job_id}/artifact", headers=headers, content=b"not-a-capture")

    assert uploaded.status_code == 422
    status = client.get(f"/api/tenants/7/tools/ainetscope/jobs/{job_id}", headers=headers)
    assert status.json()["job"]["state"] == "failed"