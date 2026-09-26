from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence


@dataclass(frozen=True)
class VectorDocument:
    tenant_id: int
    item_id: str
    text: str
    vector: tuple[float, ...]
    metadata: dict[str, Any] = field(default_factory=dict)


class InMemoryVectorStore:
    """Local vector-store boundary; replaceable with a tenant-scoped pgvector repository."""

    def __init__(self):
        self._documents: dict[tuple[int, str], VectorDocument] = {}

    async def upsert(self, document: VectorDocument) -> VectorDocument:
        self._documents[(document.tenant_id, document.item_id)] = document
        return document

    async def search(self, tenant_id: int, vector: Sequence[float], top_k: int = 10, agent_ids: Sequence[str] | None = None) -> list[VectorDocument]:
        candidates = [document for (document_tenant_id, _), document in self._documents.items() if document_tenant_id == tenant_id]
        if agent_ids is not None:
            allowed = set(agent_ids)
            candidates = [document for document in candidates if document.metadata.get("agent_id") in allowed]
        ranked = sorted(candidates, key=lambda document: _cosine_similarity(vector, document.vector), reverse=True)
        return ranked[:top_k]


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        return 0.0
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if not left_norm or not right_norm:
        return 0.0
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)
