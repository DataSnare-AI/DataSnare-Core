from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


PLUGIN_CONTRACT_SCHEMA = "datasnare-analysis-plugin/v1"
EVIDENCE_ENVELOPE_SCHEMA = "datasnare-analysis-evidence/v1"


class AnalysisPluginManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    contract_schema: Literal["datasnare-analysis-plugin/v1"] = Field(
        default=PLUGIN_CONTRACT_SCHEMA, alias="schema"
    )
    plugin_id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,63}$")
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    status: Literal["first-party", "community", "planned"]
    input_artifact_types: list[str] = Field(default_factory=list)
    output_schema: str | None = None
    contributions: list[str] = Field(default_factory=list)
    required_capabilities: list[str] = Field(default_factory=list)


class NormalizedEvidenceEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    timestamp: str | None = None
    severity: Literal["info", "warning", "error", "critical"] = "info"
    category: str | None = None
    host: str | None = None
    process: str | None = None
    summary: str = Field(min_length=1)
    detail: Any = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class AnalysisEvidenceEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    contract_schema: Literal["datasnare-analysis-evidence/v1"] = Field(
        default=EVIDENCE_ENVELOPE_SCHEMA, alias="schema"
    )
    tenant_id: int = Field(gt=0)
    plugin_id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,63}$")
    plugin_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    source_schema: str
    source_id: str
    source_name: str
    events: list[NormalizedEvidenceEvent] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


FIRST_PARTY_PLUGIN_MANIFESTS = {
    "airca": AnalysisPluginManifest(
        plugin_id="airca",
        name="AIRootCause",
        version="0.1.0",
        status="first-party",
        input_artifact_types=["json"],
        output_schema="datasnare-rootcause/investigation-v1",
        contributions=["investigation", "timeline", "findings"],
    ),
    "ailogscope": AnalysisPluginManifest(
        plugin_id="ailogscope",
        name="AILogScope",
        version="0.1.0",
        status="first-party",
        input_artifact_types=["log", "txt", "json", "yaml", "pdf"],
        output_schema="datasnare-ailogscope/events-v1",
        contributions=["events", "findings"],
    ),
    "aiperf": AnalysisPluginManifest(
        plugin_id="aiperf",
        name="AIPerf",
        version="0.1.0",
        status="first-party",
        input_artifact_types=["blg", "csv", "xml", "json"],
        output_schema="datasnare-aiperf/events-v1",
        contributions=["metrics", "findings", "timeline"],
    ),
    "aiprocmon": AnalysisPluginManifest(
        plugin_id="aiprocmon",
        name="AIProcMon",
        version="0.1.0",
        status="first-party",
        input_artifact_types=["pml", "csv", "xml", "json"],
        output_schema="datasnare-aiprocmon/events-v1",
        contributions=["process-events", "findings", "process-map"],
    ),
    "ainetscope": AnalysisPluginManifest(
        plugin_id="ainetscope",
        name="AINetScope",
        version="0.1.0",
        status="first-party",
        input_artifact_types=["pcap", "pcapng", "cap"],
        output_schema="datasnare-ainetscope/analysis-v1",
        contributions=["flows", "findings", "timeline"],
    ),
    "aimemorydump": AnalysisPluginManifest(
        plugin_id="aimemorydump",
        name="AIMemoryDump",
        version="0.1.0",
        status="planned",
    ),
}


def ailogscope_evidence_envelope(
    *, tenant_id: int, job_id: str, artifact_name: str, analysis: dict[str, Any]
) -> AnalysisEvidenceEnvelope:
    return AnalysisEvidenceEnvelope(
        tenant_id=tenant_id,
        plugin_id="ailogscope",
        plugin_version="0.1.0",
        source_schema=str(analysis.get("schema") or "datasnare-ailogscope/events-v1"),
        source_id=job_id,
        source_name=artifact_name,
        events=analysis.get("preview") or [],
        findings=[],
        metadata={
            "event_count": int(analysis.get("events") or 0),
            "severity_counts": analysis.get("severity_counts") or {},
            "parser": analysis.get("parser"),
            "source_encoding": analysis.get("source_encoding"),
        },
    )


def normalized_plugin_evidence_envelope(
    *,
    tenant_id: int,
    plugin_id: str,
    plugin_version: str,
    job_id: str,
    artifact_name: str,
    source_schema: str,
    events: list[dict[str, Any]],
    findings: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AnalysisEvidenceEnvelope:
    return AnalysisEvidenceEnvelope(
        tenant_id=tenant_id,
        plugin_id=plugin_id,
        plugin_version=plugin_version,
        source_schema=source_schema,
        source_id=job_id,
        source_name=artifact_name,
        events=events,
        findings=findings or [],
        metadata=metadata or {},
    )