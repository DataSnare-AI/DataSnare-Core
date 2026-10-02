import pathlib
import sys

from pydantic import ValidationError
import pytest

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.analysis_plugin_contract import (
    FIRST_PARTY_PLUGIN_MANIFESTS,
    AnalysisEvidenceEnvelope,
    AnalysisPluginManifest,
    PLUGIN_CONTRACT_SCHEMA,
    ailogscope_evidence_envelope,
)


def test_plugin_registry_has_five_first_party_plugins_and_planned_memory_dump():
    assert set(FIRST_PARTY_PLUGIN_MANIFESTS) == {
        "airca", "ailogscope", "aiperf", "aiprocmon", "ainetscope", "aimemorydump"
    }
    assert FIRST_PARTY_PLUGIN_MANIFESTS["aimemorydump"].status == "planned"
    assert FIRST_PARTY_PLUGIN_MANIFESTS["ailogscope"].model_dump(by_alias=True)["schema"] == PLUGIN_CONTRACT_SCHEMA


def test_plugin_manifest_rejects_unrecognized_fields():
    with pytest.raises(ValidationError):
        AnalysisPluginManifest(
            plugin_id="community-parser",
            name="Community Parser",
            version="1.0.0",
            status="community",
            executable="untrusted.py",
        )


def test_normalized_envelope_preserves_plugin_specific_event_fields():
    envelope = ailogscope_evidence_envelope(
        tenant_id=17,
        job_id="job-123",
        artifact_name="service.log",
        analysis={
            "schema": "datasnare-ailogscope/events-v1",
            "events": 1,
            "severity_counts": {"error": 1},
            "parser": "ailogscope-python-text-parser-v1",
            "source_encoding": "utf-8",
            "preview": [{
                "timestamp": "2026-10-01T12:00:00Z",
                "severity": "error",
                "summary": "service failed",
                "evidence": {"sourceLine": 4},
            }],
        },
    )

    payload = envelope.model_dump(by_alias=True)
    assert payload["schema"] == "datasnare-analysis-evidence/v1"
    assert payload["tenant_id"] == 17
    assert payload["source_id"] == "job-123"
    assert payload["events"][0]["evidence"] == {"sourceLine": 4}
    assert payload["metadata"]["severity_counts"] == {"error": 1}


def test_evidence_envelope_rejects_invalid_tenant_and_severity():
    with pytest.raises(ValidationError):
        AnalysisEvidenceEnvelope(
            tenant_id=0,
            plugin_id="ailogscope",
            plugin_version="0.1.0",
            source_schema="datasnare-ailogscope/events-v1",
            source_id="job-123",
            source_name="service.log",
            events=[{"severity": "urgent", "summary": "unexpected"}],
        )
