"""FastEmbed wrapper.

A thin facade so the rest of sofia depends on a small interface, not
on FastEmbed's API directly. Lazily loads the model on first use.
"""
from __future__ import annotations

from typing import Iterable

from fastembed import TextEmbedding


class Embedder:
    def __init__(self, model_name: str, cache_dir: str | None = None) -> None:
        self._model_name = model_name
        self._cache_dir = cache_dir
        self._model: TextEmbedding | None = None

    @property
    def dim(self) -> int:
        # all-MiniLM-L6-v2 outputs 384 dimensions. Hard-coded to avoid an
        # extra inference round-trip just to discover the size.
        return 384

    def _ensure_model(self) -> TextEmbedding:
        if self._model is None:
            kwargs: dict = {"model_name": self._model_name}
            if self._cache_dir is not None:
                kwargs["cache_dir"] = self._cache_dir
            self._model = TextEmbedding(**kwargs)
        return self._model

    def embed(self, texts: Iterable[str]) -> list[list[float]]:
        model = self._ensure_model()
        return [list(map(float, v)) for v in model.embed(list(texts))]
