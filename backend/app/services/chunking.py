from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KnowledgeChunk:
    chunk_index: int
    text: str
    start_offset: int
    end_offset: int


def chunk_text(text: str, *, max_chars: int = 1200, overlap_chars: int = 120) -> list[KnowledgeChunk]:
    """Split local evidence deterministically while retaining offsets and bounded overlap."""
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    if overlap_chars < 0 or overlap_chars >= max_chars:
        raise ValueError("overlap_chars must be non-negative and smaller than max_chars")
    normalized = text.strip()
    if not normalized:
        return []

    chunks: list[KnowledgeChunk] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + max_chars)
        if end < len(normalized):
            boundary = normalized.rfind("\n", start, end)
            if boundary <= start:
                boundary = normalized.rfind(" ", start, end)
            if boundary > start:
                end = boundary
        piece = normalized[start:end].strip()
        if piece:
            chunks.append(KnowledgeChunk(len(chunks), piece, start, end))
        if end >= len(normalized):
            break
        next_start = max(start + 1, end - overlap_chars)
        start = next_start
    return chunks
