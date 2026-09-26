import pathlib
import sys

import pytest


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.embeddings import LocalHashEmbeddingProvider


def test_local_embedding_is_deterministic_and_normalized():
    provider = LocalHashEmbeddingProvider(dimensions=32)

    first = provider.embed("Database service restart runbook")
    second = provider.embed("Database service restart runbook")

    assert first.model == "local-hash-v1"
    assert first.dimensions == 32
    assert first.vector == second.vector
    assert sum(value * value for value in first.vector) == pytest.approx(1.0)


def test_local_embedding_batch_preserves_input_order():
    provider = LocalHashEmbeddingProvider(dimensions=16)

    records = provider.embed_batch(["alpha", "beta", "gamma"])

    assert len(records) == 3
    assert records[0].vector != records[1].vector
    assert all(record.dimensions == 16 for record in records)


def test_local_embedding_rejects_tiny_dimensions():
    with pytest.raises(ValueError):
        LocalHashEmbeddingProvider(dimensions=4)