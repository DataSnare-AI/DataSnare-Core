# DataSnare-Core Local/Staging Deployment

Core has a container scaffold for local smoke testing and a staging deployment behind Azure's TLS/reverse-proxy layer. It does not change the existing AIOps site or deployment script.

## Local preview

From the Core repository root:

```powershell
Copy-Item .env.core.example .env.core
# Edit .env.core if you want non-default hostnames/port.
docker compose --env-file .env.core -f docker-compose.core.yml up --build -d
```

Local URLs:

- Core UI and same-origin API: `http://localhost:8080`
- Direct Core API host routing: `http://api.localhost:8080`
- Readiness: `http://localhost:8080/api/health/readiness`

Stop the preview with:

```powershell
docker compose --env-file .env.core -f docker-compose.core.yml down
```

The preview compose binds to loopback and sets `DATASNARE_ENV=development`. It uses in-memory repositories and development actor headers. It is not production-ready and does not connect to AIOps or Azure PostgreSQL.

## Azure staging routing

The `docker-compose.staging.yml` profile joins Core to an existing Docker edge network and does not
publish host ports. It is intended to share the network with the AIOps Caddy container; it does not
replace or restart AIOps. Confirm that the VM's AIOps deployment uses this Docker network and that its
Caddy container is attached before starting Core.

For staging, set the compose environment values to:

```text
CORE_APP_DOMAIN=staging.app.datasnare.com
CORE_API_DOMAIN=staging.api.datasnare.com
```

On the VM, identify the network used by AIOps Caddy:

```bash
docker inspect <aiops-caddy-container> --format '{{json .NetworkSettings.Networks}}'
```

Set `CORE_EDGE_NETWORK` to the actual network name and deploy Core separately:

```bash
export CORE_EDGE_NETWORK=<existing-aiops-edge-network>
export CORE_APP_DOMAIN=staging.app.datasnare.com
export CORE_API_DOMAIN=staging.api.datasnare.com
docker compose --env-file .env.core -f docker-compose.staging.yml up --build -d
```

Before exposing either name through public DNS ingress, merge `deploy/Caddyfile.staging.example` into
the existing AIOps edge Caddy configuration. Replace its documentation-only `192.0.2.10/32` allowlist
with the approved tester/VPN egress CIDR, validate the Caddy configuration, then reload the existing
Caddy service. Both staging hostnames are IP restricted by default. Keep `datasnare-aiops.com` routed
to the existing AIOps deployment.

After the edge proxy and DNS records resolve, verify from an allowed client:

```bash
curl -fsS https://staging.app.datasnare.com/ | head
curl -fsS https://staging.api.datasnare.com/api/health/readiness
```

## Production gate

Do not deploy this scaffold as production yet. The API factory accepts injected `database_pool` and `auth_provider` objects, but the container entrypoint does not create those services. Production readiness must remain `not_ready` until:

- A Core database pool is created from the Core-only `DATABASE_URL`.
- PostgreSQL has `pgvector` and `backend/migrations/001_rag_foundation.sql` is applied to `datasnare_core`.
- A real authentication provider is connected and tenant claims are enforced by Core authorization.
- In-memory ingest jobs, manifests, graph, retrieval audit, and site-cache implementations are replaced or consciously assigned retention semantics.
- Upload artifacts have tenant-scoped durable storage, size limits, retention policy, and audit logging.
- TLS ingress, host routing, CORS policy for any cross-origin API usage, secrets, health probes, backups, and rollback are configured.

Production hostnames remain `app.datasnare.com` and `api.datasnare.com`; staging validation should pass first. The existing AIOps database must remain isolated: Core connects to `datasnare_core` and consumes AIOps knowledge through its authenticated API/event boundary, not direct AIOps table access.
