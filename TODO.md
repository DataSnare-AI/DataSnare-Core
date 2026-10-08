# Development Backlog

- [x] Two-Sided: side-specific packet marking and independent System A/System B time-reference frames. Original timestamps and clock corrections remain separate from display references.
- [x] Two-Sided Analytics/Expert dashboard: filtered paired timing by direction, negative samples/clock caveats, visibility-gap diagnostics, captured handshake options and flow-control estimates. Versioned findings import into AIAnalysis and standalone AIRootCause with scope and paired provenance.

## Core Platform Roadmap

- [ ] Tenant lifecycle management
	- [ ] Define and implement tenant onboarding: create/provision tenant, establish its initial administrator and membership, configure defaults, and expose progress/errors in the Core UI.
	- [ ] Define tenant deactivation and deletion semantics, including confirmation and authorization, soft-delete versus permanent purge, retention/legal holds, dependent-data cleanup across Core and connected services, credential revocation, and auditable outcomes.
	- [ ] Make onboarding/deletion APIs tenant-scoped, role-authorized, idempotent where appropriate, and covered by lifecycle, isolation, failure-recovery, and audit tests.
- [ ] Move outbound email service ownership from AIOps into Core
	- [ ] Inventory AIOps email call sites, templates, recipients, platform settings, environment variables, test-email behavior, and delivery/fallback policies; define a versioned authenticated Core email API and tenant/platform ownership model.
	- [ ] Implement Core-owned SMTP and SendGrid providers, including SendGrid API-key/sender setup, configuration validation, test email, secret encryption/redaction/rotation, timeouts, delivery errors, and an explicit fallback policy.
	- [ ] Migrate AIOps alert, approval, report-delivery, and other email callers to the Core API; migrate settings/secrets safely, preserve tenant isolation and audit context, and remove duplicate AIOps email configuration only after a verified rollout/rollback plan.
	- [ ] Add provider contract/integration tests for success, invalid configuration, provider outage/fallback, authorization, tenant isolation, secret non-disclosure, and migration/rollback. Keep Twilio SMS and SMS-reply approvals separate from this email migration unless separately scoped.

- [ ] Planned: agent-assisted Windows BLG/PML conversion for customers with an eligible AIOps agent. Inspect existing AIOps dispatch/file-transfer capabilities first. Request conversion through authenticated AIOps APIs, not direct database access; require device/tenant authorization and explicit conversion/upload consent. Use fixed converter operations, validated local paths, isolated output directories, time/disk limits, cleanup, and audited original/output hashes plus converter/device/capture-time provenance. Start with relog.exe for BLG; validate supported Procmon execution, service-account behavior, licensing and tool availability before PML. Use short-lived tenant/job-scoped upload authorization. Retain downloadable local helpers for customers without agents. Do not implement agent execution yet.

- [ ] Last/deferred until other development work is complete: evaluate offline standalone distribution and practical source protection. See the final item in the AINetScope development backlog. Delivered JavaScript or binaries cannot guarantee protection against reverse engineering.