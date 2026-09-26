from __future__ import annotations

from typing import Protocol

from app.contracts.knowledge import KnowledgeItem


class KnowledgeItemRepository(Protocol):
    async def create(self, item: KnowledgeItem) -> KnowledgeItem: ...

    async def list_for_tenant(self, tenant_id: int) -> list[KnowledgeItem]: ...


class InMemoryKnowledgeItemRepository:
    """Replaceable repository for the DS-RAG-001 contract and route tests."""

    def __init__(self):
        self._items: dict[tuple[int, str], KnowledgeItem] = {}

    async def create(self, item: KnowledgeItem) -> KnowledgeItem:
        self._items[(item.tenant_id, item.item_id)] = item
        return item

    async def list_for_tenant(self, tenant_id: int) -> list[KnowledgeItem]:
        return [item for (item_tenant_id, _), item in self._items.items() if item_tenant_id == tenant_id]
