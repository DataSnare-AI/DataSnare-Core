from __future__ import annotations

from typing import Protocol

from app.contracts.agent_manifest import AgentManifest


class AgentManifestRepository(Protocol):
    async def upsert(self, manifest: AgentManifest) -> AgentManifest: ...

    async def list_for_tenant(self, tenant_id: int) -> list[AgentManifest]: ...

    async def get(self, tenant_id: int, agent_id: str) -> AgentManifest | None: ...


class InMemoryAgentManifestRepository:
    def __init__(self):
        self._manifests: dict[tuple[int, str], AgentManifest] = {}

    async def upsert(self, manifest: AgentManifest) -> AgentManifest:
        self._manifests[(manifest.tenant_id, manifest.agent_id)] = manifest
        return manifest

    async def list_for_tenant(self, tenant_id: int) -> list[AgentManifest]:
        return [manifest for (manifest_tenant_id, _), manifest in self._manifests.items() if manifest_tenant_id == tenant_id]

    async def get(self, tenant_id: int, agent_id: str) -> AgentManifest | None:
        return self._manifests.get((tenant_id, agent_id))
