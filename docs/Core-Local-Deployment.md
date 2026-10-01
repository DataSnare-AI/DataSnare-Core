# DataSnare-Core Local/Staging Deployment

Core has a container scaffold for local smoke testing and a staging deployment behind Azure's TLS/reverse-proxy layer. It does not change the existing AIOps site or deployment script.

## Local preview

From the Core repository root:

```powershell
Copy-Item .env.core.example .env.core
# Generate a Fernet key, then add CORE_STORAGE_ENCRYPTION_KEY=<key> to .env.core.
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Keep this key private and unchanged; saved Azure credentials depend on it.
# Edit .env.core if you want non-default hostnames/port.
docker compose --env-file .env.core -f docker-compose.core.yml up --build -d
```

`CORE_STORAGE_ENCRYPTION_KEY` is required when saving Azure connection strings, account keys,
or SAS tokens in Core Admin > Storage. The local Compose service passes this value to the API.

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

Keep the repositories in separate directories on the Azure VM:

- Existing AIOps checkout: `/opt/datasnare`
- Core checkout: `/opt/datasnare-core`

This lets Core updates use `git pull` independently and prevents Core Compose commands from changing
the AIOps working tree. Store Core's deployment-only `.env.core` in `/opt/datasnare-core` with
permissions restricted to the deployment account; do not copy AIOps secrets into it. Use a distinct
Compose project name (`datasnare-core`) for Core lifecycle commands.

Initial checkout and later update:

```bash
git clone <core-repository-url> /opt/datasnare-core
cd /opt/datasnare-core
git pull --ff-only
```

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
docker compose -p datasnare-core --env-file .env.core -f docker-compose.staging.yml up --build -d
```

For explicit container/network naming, include `-p datasnare-core` in Compose commands. Do not run
`docker compose down` from `/opt/datasnare`; that remains the independent AIOps deployment.

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

Do not deploy this scaffold as production yet. The API creates and closes an asyncpg pool from Core-only `DATABASE_URL` when configured, and selects PostgreSQL adapters for ingest jobs, knowledge items, agent manifests, graph edges,
retrieval audits, and vectors. The pool can be tuned with `DB_POOL_MIN_SIZE`, `DB_POOL_MAX_SIZE`, and `DB_COMMAND_TIMEOUT_SECONDS`. Production readiness must remain `not_ready` until:

- `pgvector` is installed and `backend/migrations/001_rag_foundation.sql` through `008_core_artifact_storage.sql` are applied to `datasnare_core`.
- A real authentication provider is connected and tenant claims are enforced by Core authorization.
- AIOps account data has been imported and reconciled into Core, including password hashes, memberships,
    and product assignments. Plaintext passwords must never be exported or logged.
- AIOps validates Core-issued sessions through Core's auth profile/introspection APIs; Core must not
    use AIOps as its login dependency.
- The in-memory site-query cache is assigned deliberate retention semantics or replaced if shared persistence is required.
- Core Admin > Storage is configured for Azure Blob and passes its connectivity test. Core uses its own prefix in the configured account/container; existing AIOps Help files and AIOps Help Storage settings remain unchanged during this transition.
- `CORE_STORAGE_ENCRYPTION_KEY` is set in the Core environment before storing connection strings, account keys, or SAS tokens. Keep the same key across rebuilds and backups. Managed identity can be used without stored Azure secrets.
- Core upload records retain tenant/product/job metadata, size, checksum, uploader, and storage reference. Retention scheduling/policy enforcement still needs to be configured before production.
- TLS ingress, host routing, CORS policy for any cross-origin API usage, secrets, health probes, backups, and rollback are configured.

Production hostnames remain `app.datasnare.com` and `api.datasnare.com`; staging validation should pass first. The existing AIOps database must remain isolated: Core connects to `datasnare_core` and consumes AIOps knowledge through its authenticated API/event boundary, not direct AIOps table access.
