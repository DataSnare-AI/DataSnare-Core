from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from typing import Protocol, Sequence


@dataclass(frozen=True)
class EmbeddingRecord:
    model: str
    dimensions: int
    vector: tuple[float, ...]


class EmbeddingProvider(Protocol):
    model: str
    dimensions: int

    def embed(self, text: str) -> EmbeddingRecord: ...

    def embed_batch(self, texts: Sequence[str]) -> list[EmbeddingRecord]: ...


class LocalHashEmbeddingProvider:
    """Deterministic offline baseline; replace with a local semantic model in DS-RAG-003 production work."""

    model = "local-hash-v1"

    def __init__(self, dimensions: int = 128):
        if dimensions < 8:
            raise ValueError("dimensions must be at least 8")
        self.dimensions = dimensions

    def embed(self, text: str) -> EmbeddingRecord:
        values = [0.0] * self.dimensions
        tokens = re.findall(r"[a-z0-9_/-]+", text.lower())
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 else -1.0
            values[index] += sign
        norm = math.sqrt(sum(value * value for value in values))
        vector = tuple(value / norm for value in values) if norm else tuple(values)
        return EmbeddingRecord(self.model, self.dimensions, vector)

    def embed_batch(self, texts: Sequence[str]) -> list[EmbeddingRecord]:
        return [self.embed(text) for text in texts]
