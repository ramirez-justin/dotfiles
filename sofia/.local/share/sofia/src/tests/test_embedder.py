import pytest

from sofia.embedder import Embedder

MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@pytest.fixture(scope="module")
def embedder() -> Embedder:
    """Module-scoped: model loads once for the whole file."""
    return Embedder(MODEL)


def test_dim_is_384(embedder: Embedder):
    assert embedder.dim == 384


def test_embed_returns_one_vector_per_input(embedder: Embedder):
    vecs = embedder.embed(["alpha", "beta", "gamma"])
    assert len(vecs) == 3
    for v in vecs:
        assert len(v) == 384
        assert all(isinstance(x, float) for x in v)


def test_same_text_gives_same_vector(embedder: Embedder):
    a = embedder.embed(["hello world"])[0]
    b = embedder.embed(["hello world"])[0]
    assert a == pytest.approx(b, abs=1e-5)


def test_different_text_gives_different_vector(embedder: Embedder):
    [a, b] = embedder.embed(["dogs and cats", "the quadratic formula"])
    assert a != pytest.approx(b, abs=1e-3)
