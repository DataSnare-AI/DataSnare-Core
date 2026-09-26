import pathlib
import sys

import pytest


BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.chunking import chunk_text


def test_chunk_text_preserves_order_offsets_and_overlap():
    text = "alpha beta gamma delta epsilon zeta eta theta iota kappa"

    chunks = chunk_text(text, max_chars=24, overlap_chars=5)

    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert chunks[0].text.startswith("alpha")
    assert chunks[-1].end_offset == len(text)
    assert all(chunk.start_offset < chunk.end_offset for chunk in chunks)
    assert any(left.text.split()[-1] == right.text.split()[0] for left, right in zip(chunks, chunks[1:]))


def test_chunk_text_ignores_empty_input():
    assert chunk_text("  \n  ") == []


@pytest.mark.parametrize("max_chars,overlap_chars", [(0, 0), (10, 10), (10, 11)])
def test_chunk_text_rejects_invalid_bounds(max_chars, overlap_chars):
    with pytest.raises(ValueError):
        chunk_text("content", max_chars=max_chars, overlap_chars=overlap_chars)