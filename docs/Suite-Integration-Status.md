# DataSnare Suite Integration Status

_Last updated: 2026-09-21_

## Current contract

Core owns the project registry in `src/contracts/projects.js`. Each independently deployable tool keeps its own UI and export lifecycle, while Core records launch metadata and normalized evidence schemas.

Current normalized evidence schemas:

- DataSnare-AILogScope: `datasnare-ailogscope/events-v1`
- DataSnare-AIPerf: `datasnare-aiperf/events-v1`
- DataSnare-AIProcMon: `datasnare-aiprocmon/events-v1`
- DataSnare-AINetScope: `datasnare-ainetscope/analysis-v1`
- DataSnare-AIRootCause: `datasnare-rootcause/investigation-v1`

Core writes `datasnare:lastLaunchContext` to `sessionStorage` using the `datasnare-core/project-launch-v1` envelope before opening a project. The tools still run standalone when no Core launch context exists.

## Verified evidence flow

AIRootCause adapter smoke tested the following normalized exports through `DataSnarePlugins.parseFile`:

- AILogScope log event export
- AIPerf performance event export
- AIProcMon finding export
- AINetScope analysis export with finding and flow records

AIRootCause UI import then loaded all four artifacts together and produced:

- 4 sources
- 5 timeline events
- AILogScope log event
- AIProcMon finding
- AIPerf performance event
- AINetScope network finding
- AINetScope network flow event

The AIRootCause file input handler now snapshots selected files before clearing the input so multi-file imports are not truncated after the first artifact.

## AILogScope robustness update

AILogScope now recognizes broader Log4j and Log4j2 layouts, including slash dates, level-before-thread patterns, bracketed levels, and stack trace continuations. It also detects UTF-8, UTF-8 BOM, UTF-16 LE, and UTF-16 BE text, and normalizes unstructured Notepad++ or plain text notes as bounded document evidence instead of discarding them.

Browser smoke test results:

- Log4j2 sample normalized into 2 structured events.
- UTF-16 `.npp` text note normalized into 1 document event.
- Export summary returned 3 events, 2 sources, and 0 orphan lines.

## Validation commands run

```powershell
# AILogScope
node --check app.js

# AINetScope
node --check app.js
node --check expert.js

# AIRootCause
node --check app.js
node --check plugins.js

# Core
npm run build

# Core backend
python -m pytest tests/test_ingest_routes.py tests/test_ninjaone_routes.py
```

Core build passed after `npm install` populated local dependencies.

## Backend threshold

Keep static browser tools for local-first evidence parsing while file sizes and workflows remain session-scoped. Move a tool to the Core/AIOps Python/Postgres backend when it needs any of the following:

- persistent multi-user evidence repositories
- indexed search across large corpora
- tenant retention and audit policies
- OCR, archive extraction, or heavyweight document parsing
- scheduled ingestion from agents or partner systems
- cross-investigation analytics

## Native ingestion roadmap

AIPerf and AIProcMon should become hybrid tools rather than browser-only tools. The current static apps remain useful for local-first CSV/XML triage, demos, and offline evidence review. A React/Python/Postgres path should be added when users need to drop native or very large captures directly into the suite.

Recommended direction:

- AIPerf keeps browser parsing for converted PDH CSV and System Diagnostics XML.
- AIPerf backend ingestion accepts native `.blg` files through a Python job API, delegates Windows-native conversion where appropriate, persists metric series in Postgres, and returns the existing `datasnare-aiperf/events-v1` normalized findings envelope.
- AIProcMon keeps browser parsing for CSV/XML ProcMon exports.
- AIProcMon backend ingestion accepts native `.pml` and large CSV captures through a Python job API, uses supported Sysinternals conversion tooling or a controlled parser/converter boundary, persists aggregate findings and retained salient evidence, and returns the existing `datasnare-aiprocmon/events-v1` envelope.
- React becomes the preferred UI for backend-backed ingestion because users need upload progress, queued/running/completed job states, persisted analyses, retry/error details, tenant context, and Core launch/account binding.
- Postgres becomes the system of record for persisted parse jobs, source artifacts, normalized event summaries, metric series, and audit/retention metadata.

Initial job contract names:

- `datasnare-ingest/job-v1`
- `datasnare-ingest/source-artifact-v1`
- `datasnare-ingest/native-conversion-v1`

Job states should start with `queued`, `running`, `completed`, `failed`, and `cancelled`.

Core now exposes the first contract stub:

- `POST /api/tenants/{tenant_id}/ingest/jobs` creates a queued native ingest job.
- `GET /api/tenants/{tenant_id}/ingest/jobs` lists queued/history jobs for the tenant.
- `GET /api/tenants/{tenant_id}/ingest/jobs/{job_id}` returns one job.

The stub requires `X-Actor`, stores jobs in the replaceable in-memory repository, and currently accepts:

- AIPerf `.blg` -> `datasnare-aiperf/events-v1`
- AIProcMon `.pml` and large `.csv` -> `datasnare-aiprocmon/events-v1`

Native parser execution is intentionally not implemented yet. `native_conversion.status` is `planned` and identifies the future Python conversion strategy.

## Next integration slice

1. Add a Python conversion service boundary for AIPerf `.blg` and AIProcMon `.pml` jobs.
2. Add a small AIRootCause regression harness for the four normalized schemas.
3. Decide whether the regression harness should live as browser Playwright checks or lightweight Node tests with a DOM shim.
4. Connect React/Core job status UI to the ingest job routes once persisted repositories are available.

## Shared authorization and RAG foundation

Core now defines the first shared authorization boundary in `backend/app/security/authorization.py`.
The development transport still accepts `X-Actor` and `X-Role`, but route decisions are tenant-scoped
and use a centralized permission vocabulary. The current roles are `viewer`, `operator`, `approver`,
`tenant_admin`, and `platform_admin`. The header boundary remains temporary and should be replaced by
the shared authenticated session and agent credential claims before production use.

The initial RAG contract is available at:

- `POST /api/tenants/{tenant_id}/rag/retrieve`

It returns `datasnare-rag/retrieval-v1`, an audit envelope, tenant and actor identity, citations, and
knowledge results. Until the local index exists, the endpoint returns `status: not_indexed`; this keeps
the contract testable while DS-RAG-001 through DS-RAG-004 are implemented.

The next implementation slice is the agent document ingestion framework and persisted knowledge-item
repository, followed by local chunking, embeddings, and `pgvector` retrieval.

DS-RAG-001 is now implemented as a replaceable tenant-scoped knowledge-item repository with document
ingestion and provenance-preserving list routes. DS-RAG-002 is implemented as a deterministic local
chunking service with bounded overlap and source offsets. The current repository is in-memory by design;
the next persistence slice will add the Postgres schema and vector-store boundary.

DS-RAG-003 now exposes an embedding-provider boundary with a deterministic offline development provider.
DS-RAG-004 now exposes a tenant-filtered local vector-store boundary. Document ingestion uses both
services, and the retrieval endpoint returns indexed, provenance-bearing results. The hash provider is
only a dependency-free baseline for development and tests; production semantic retrieval must replace it
with an approved local embedding model without changing the route or evidence contracts.

DS-RAG-010 now defines tenant-scoped agent manifests. Tenant administrators can register an agent's
site, area, capabilities, knowledge types, and status; retrieval roles can list manifests for routing.
The repository is replaceable and currently in-memory while the coordinator persistence model is being
established.

DS-RAG-011 now routes retrieval through eligible online or degraded manifests using tenant, site, area,
agent, and knowledge-type filters. The selected agent IDs and routing reason are included in the retrieval
audit event. When a tenant has no manifests yet, local retrieval retains the compatibility behavior of
searching that tenant's indexed evidence without an agent restriction.

DS-RAG-012 and DS-RAG-013 now provide replaceable cross-agent candidate aggregation and deterministic
term-aware reranking helpers. DS-RAG-014 persists retrieval audit events through a tenant-scoped
repository and exposes them at `GET /api/tenants/{tenant_id}/rag/audit` for authorized operational roles.

Phase 3 has started with DS-RAG-020 site query planning and DS-RAG-023 site cache boundaries. Query plans
normalize site, area, agent, and result constraints into stable cache keys; the current cache is an
in-memory tenant-scoped implementation with explicit TTL behavior. Cross-area correlation, evidence
deduplication across site agents, and the site knowledge graph remain the next Phase 3 slices.

## Shared visual skins

Core now exposes two persisted suite skin choices through `src/contracts/skins.js`:

- `ainetscope`: paper surfaces, mono typography, and evidence-analysis signal colors.
- `aiops`: denser operational-console surfaces, slate backgrounds, and blue status accents.

AINetScope is the default. The selector is intentionally a Core preference so future React tool
versions can consume the same visual language without forcing every product into one layout. More
skins can be added after the first React/Python migrations mature.
