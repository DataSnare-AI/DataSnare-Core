# DataSnare-Core

The shared DataSnare suite shell for `app.datasnare.com`.

Core owns the suite-level navigation and the integration contract for:

- shared identity and session handoff
- per-project license visibility
- project launch URLs
- future organization, billing, and account settings
- partner integrations such as NinjaOne RMM

Each tool remains independently deployable and can be licensed on its own. The full app suite adds shared identity, scoped session handoff, cross-tool navigation, and a single view of the user's project entitlements without coupling the tools' release cycles.

Core also acts as the partner connection point. NinjaOne RMM is planned as the first external integration, with organization and device inventory, alerts, activities, health and patch reports, ticketing, and controlled management actions available through a tenant-scoped connector. Partner access is separate from DataSnare project licensing.

Update `src/App.jsx` when a production deployment URL changes, or move the registry to a Core API when the identity and licensing services are available.

Partner connection metadata is defined in `src/contracts/partnerIntegrations.js`. It is intentionally provider-neutral at the contract boundary: the backend owns credentials, connection state, capability checks, and external API calls.

Project launch metadata is defined in `src/contracts/projects.js`. The registry records each tool path, browser integration global, normalized export schema, and launch capabilities so Core can hand off tenant/account context without coupling the individual tool release cycles.

Current normalized evidence schemas:

- AILogScope: `datasnare-ailogscope/events-v1`
- AIPerf: `datasnare-aiperf/events-v1`
- AIProcMon: `datasnare-aiprocmon/events-v1`
- AIRootCause: `datasnare-rootcause/investigation-v1`
- AINetScope: `datasnare-ainetscope/analysis-v1`

## Local development

```powershell
npm install
npm run dev
```

## Production shape

Deploy the built app at `https://app.datasnare.com`. Each registry entry points to a stable project path on that host. A project may also be deployed and sold independently; the suite gateway simply supplies the shared account context when the customer has access to more than one tool.

## NinjaOne RMM

The public API reference is [NinjaOne Public API 2.0](https://app.ninjarmm.com/apidocs/). Core should use a backend connector so OAuth/client credentials and refresh tokens never reach the browser. Begin with read-only synchronization, then add explicit permission gates and audit logging before enabling management actions such as reboot, service control, scripts, patch operations, or ticket writes.
