# AIAnalysis Plugin Contract (Draft v1)

AIAnalysis is planned as a unified investigation product. Its analyzers contribute evidence through versioned contracts while remaining independently maintainable products or modules. Core remains the authority for tenant identity, user permissions, product entitlements, and partner connections.

This document describes the current contract foundation. It is not a promise that arbitrary plugin code can be installed or executed. The catalog currently reports `execution_enabled: false`.

## Current Endpoints

`GET /api/projects/analysis-plugins` returns the plugin catalog, the plugin manifest schema version, the normalized evidence envelope version, and the execution-enabled flag. It is metadata only.

Implemented analyzer upload routes continue to use their existing product-specific APIs. AILogScope, AIPerf, AIProcMon, and AINetScope now return their native `analysis` payload plus a shared `evidence` envelope. Existing native fields are retained for compatibility.

## Manifest

The manifest schema identifier is `datasnare-analysis-plugin/v1`. The current Pydantic model rejects unknown fields (`extra=forbid`). Its JSON fields are:

| Field | Meaning |
| --- | --- |
| `schema` | Literal contract identifier `datasnare-analysis-plugin/v1`. |
| `plugin_id` | Stable lowercase identifier matching `^[a-z][a-z0-9-]{1,63}$`. |
| `name` | Human-readable plugin name, 1–120 characters. |
| `version` | Semantic version in `major.minor.patch` form. |
| `status` | `first-party`, `community`, or `planned`. This describes ownership/readiness metadata, not permission to execute. |
| `input_artifact_types` | Supported input extensions/types, without a leading dot. |
| `output_schema` | Plugin-native output schema identifier, or `null` while planned. |
| `contributions` | UI/data contribution categories such as `events`, `findings`, `timeline`, `flows`, or `investigation`. |
| `required_capabilities` | Declared capability names. Enforcement and capability grants remain future runtime work. |

The current catalog includes AIRootCause, AILogScope, AIPerf, AIProcMon, AINetScope, and planned AIMemoryDump. Some entries are design/ownership declarations only; a manifest does not assert that a server adapter currently exists.

## Normalized Evidence Envelope

The shared envelope is `datasnare-analysis-evidence/v1`:

```json
{
  "schema": "datasnare-analysis-evidence/v1",
  "tenant_id": 42,
  "plugin_id": "ailogscope",
  "plugin_version": "0.1.0",
  "source_schema": "datasnare-ailogscope/events-v1",
  "source_id": "job-id",
  "source_name": "service.log",
  "events": [],
  "findings": [],
  "metadata": {}
}
```

Each normalized event requires a non-empty `summary`; common optional fields are `timestamp`, `severity`, `category`, `host`, `process`, `detail`, and `evidence`. Severity is one of `info`, `warning`, `error`, or `critical`. Additional plugin-specific event fields are preserved so the shared layer does not discard useful detail.

`tenant_id`, `plugin_id`, `plugin_version`, and source identifiers are attached by the trusted host adapter, not accepted as authority claims from untrusted plugin output. The backend validates the envelope before it becomes shared AIAnalysis evidence.

## Processing Boundary

The intended flow is:

1. Core authenticates the user and resolves tenant access and AIAnalysis entitlement.
2. AIAnalysis selects an enabled plugin from an approved catalog and validates its declared input type and required capabilities.
3. The plugin receives only the input artifact and scoped execution context required for its task.
4. The plugin returns its native result; a trusted adapter validates and converts it to the common envelope.
5. AIAnalysis stores source artifacts and normalized results with tenant, plugin, version, and provenance metadata, then presents/correlates the evidence.

Plugins must not receive Core database credentials, Azure credentials, partner OAuth secrets, or unrestricted tenant data. Access to NinjaOne or other partners remains a separately authorized Core integration; plugin access must use a scoped, audited broker rather than partner credentials.

## Community Plugin Trust Model

Community plugins are not executable today. Before enabling them, the platform needs an explicit approval and runtime design, including:

- Publisher identity, immutable versioned package, signature/provenance, review status, and revocation.
- Isolated execution (separate worker/process/container or remote service), resource/time limits, and no ambient credentials.
- Tenant-scoped input access and capability checks enforced server-side.
- Output-size/schema validation, safe error handling, audit events, and cancellation/timeouts.
- A compatibility policy for manifest, evidence-envelope, and plugin-version changes.

Until those controls exist, community entries may be designed or catalogued, but only built-in server-owned adapters may process uploads.

## Versioning and Conformance

- Additive optional fields may be introduced within a compatible contract revision; changing required fields or semantics requires a new schema version.
- Keep each plugin's native `source_schema` alongside the shared envelope so old consumers and domain-specific fields remain usable.
- A plugin adapter must have tests for manifest validation, accepted input types, tenant/provenance assignment, normalized event validation, failure handling, and preservation of its native output.
- `aimemorydump` stays `planned` with no accepted input types or output schema until its formats, safety limits, and normalized findings are defined.
