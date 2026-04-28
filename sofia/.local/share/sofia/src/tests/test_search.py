from __future__ import annotations

from pathlib import Path

import pytest

from sofia import db, indexer, search


class StubEmbedder:
    """Returns a vector keyed on a tiny vocabulary so vector hits are predictable."""
    dim = 384

    _VOCAB = {
        "uv": [1.0, 0.0, 0.0],
        "review": [0.0, 1.0, 0.0],
        "memory": [0.0, 0.0, 1.0],
    }

    def _vec(self, text: str) -> list[float]:
        v = [0.0, 0.0, 0.0]
        for word, key_vec in self._VOCAB.items():
            if word in text.lower():
                for i in range(3):
                    v[i] += key_vec[i]
        # pad to 384 dims
        return v + [0.0] * 381

    def embed(self, texts):
        return [self._vec(t) for t in texts]


@pytest.fixture
def populated_db(tmp_vault: Path, tmp_db: Path):
    conn = db.connect(tmp_db)
    indexer.index_vault(
        conn=conn, vault=tmp_vault, embedder=StubEmbedder(),
        ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
    )
    yield conn
    conn.close()


def test_search_returns_top_results(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="uv", limit=10, vec_weight=0.7, fts_weight=0.3,
    )
    assert len(results) > 0
    # The personal-memory entry mentions "uv" — should be in top results.
    paths = [r.path for r in results]
    assert "_agent/memory/personal.md" in paths


def test_filter_by_context(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="memory", context="work", limit=10,
        vec_weight=0.7, fts_weight=0.3,
    )
    assert all(r.context in {"work", "universal"} for r in results)


def test_filter_by_type(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="memory", doc_type="memory", limit=10,
        vec_weight=0.7, fts_weight=0.3,
    )
    assert all(r.type == "memory" for r in results)


def test_snippet_trims_around_match(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="quarterly", limit=5,
        vec_weight=0.7, fts_weight=0.3,
    )
    if results:
        for r in results:
            assert len(r.snippet) <= 220  # 200 +/- ellipsis
