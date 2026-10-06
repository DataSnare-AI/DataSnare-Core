# NinjaOne RMM Integration

DataSnare-Core will connect to NinjaOne as a partner service. NinjaOne remains an external system; its API access is not a DataSnare project license.

## Reference

- [NinjaOne Public API 2.0](https://oc.ninjarmm.com/apidocs/?links.active=authorization)
- OpenAPI document: `https://app.ninjarmm.com/apidocs/NinjaRMM-API-v2.json`

## OAuth2 authentication

NinjaOne documents OAuth2 authorization-code and implicit grants. Core will use the authorization-code grant because the client secret and token exchange can remain on the server. Core will not use the implicit grant for the integrated application because it would place tokens in a browser context.

Authorization endpoints:

- Authorize: `https://oc.ninjarmm.com/ws/oauth/authorize`
- Token: `https://oc.ninjarmm.com/ws/oauth/token`

The callback validates a hashed, one-time `state` value that expires after 10 minutes, exchanges the code server-side, encrypts the resulting refresh token, and associates the connection with the tenant that initiated authorization. Access tokens remain in backend memory only.

For staging, register this exact Redirect URI in NinjaOne:

```text
https://staging.app.datasnare.com/api/integrations/ninjaone/callback
```

Set `NINJAONE_REDIRECT_URI` to the same value in the Core backend and keep the existing `CORE_STORAGE_ENCRYPTION_KEY` stable across restarts and deployments. The same encryption key is used for the client secret and refresh token at rest. Apply `backend/migrations/012_ninjaone_connections.sql` before enabling the connection. The authorize endpoint currently permits only the `monitoring` scope; Management and Control remain unavailable for this read-only phase. Enable NinjaOne's Refresh token grant.

## Planned phases

### Phase 1: Read-only inventory and health

- Store a tenant-scoped NinjaOne connection record.
- Keep credentials and refresh tokens server-side in the Core/AIOps backend.
- Sync organizations, locations, devices, device roles, and groups.
- Import alerts, activities, device health, operating systems, software, disks, volumes, network interfaces, and patch reports.
- Map external organization/device IDs to DataSnare tenant/system IDs.
- Show connection health, last sync time, and API errors in Core.

### Phase 2: Investigation links

- Link DataSnare findings to the originating NinjaOne organization and device.
- Open the corresponding NinjaOne dashboard URL from an evidence record.
- Correlate NinjaOne alerts and activities with AILogScope, AIPerf, AIProcMon, AINetScope, and AIRootCause evidence.
- Add inbound webhooks for alert/activity changes where tenant configuration permits.

### Phase 3: Controlled actions

Management actions must pass DataSnare authorization, project licensing, tenant policy, approval, and audit checks before reaching NinjaOne. Candidate actions include:

- device maintenance scheduling
- reboot
- Windows service control
- script or built-in action execution
- OS/software patch scan and apply
- ticket creation, comments, and updates

No management action should be exposed directly from a browser with stored NinjaOne credentials.

## Connector boundary

The connector should normalize external data into stable DataSnare contracts:

```text
NinjaOne API -> Core/AIOps connector -> normalized systems, alerts, activities, evidence, actions
```

Recommended backend boundaries:

- `ninjaone_connections`: tenant-scoped endpoint and encrypted credential reference
- `ninjaone_sync_jobs`: queued syncs, cursors, retry state, and last successful run
- `ninjaone_external_links`: external organization/device/alert/ticket IDs
- `ninjaone_webhook_events`: verified inbound events and replay status
- `ninjaone_action_audit`: requested action, DataSnare decision, external response, and actor

The browser should receive normalized DataSnare objects, never raw secrets or unfiltered partner responses.

## First implementation slice

The initial connector lives in `backend/app/services/ninjaone.py`. It is deliberately read-only and provides:

- versioned endpoint construction
- bearer-token requests through a server-side `aiohttp` session
- OAuth2 authorization-code URL construction and server-side code exchange
- collection envelope normalization
- stable external entity links for cross-tool evidence

The connector now persists encrypted client and refresh credentials plus OAuth state, and exposes tenant-protected setup/status routes and a state-protected callback. It remains read-only and does not perform NinjaOne management actions; those require licensing checks, tenant policy, audit, and approval gates.

## Core API boundary

The initial Core API is in `backend/app/routes/ninjaone.py`:

- `GET /api/tenants/{tenant_id}/integrations/ninjaone/connection` returns redacted connection metadata and requires tenant configuration view permission.
- `POST /api/tenants/{tenant_id}/integrations/ninjaone/authorize` requires tenant configuration edit permission, encrypts the client secret, stores expiring OAuth state, and returns an OAuth2 authorization-code URL.
- `GET /api/integrations/ninjaone/callback` validates and consumes state, exchanges the code, and encrypts the refresh token.

With a database configured, connection metadata, encrypted credentials, and state are persisted in PostgreSQL. Local route tests use an in-memory repository. The callback is public by design, with authorization bound to the unguessable one-time state; the authorize and status routes use Core tenant identity and permissions.