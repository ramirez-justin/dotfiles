from __future__ import annotations

import time
from pathlib import Path

import pytest

from sofia import db, indexer


# A minimal stub embedder so indexer tests don't pay the FastEmbed cost.
class StubEmbedder:
    dim = 384

    def embed(self, texts):
        # Deterministic but distinct: vector[0] = len(text), rest = zeros.
        return [[float(len(t))] + [0.0] * 383 for t in texts]


@pytest.fixture
def stub_embedder() -> StubEmbedder:
    return StubEmbedder()


def test_should_skip_for_ignore_glob():
    assert indexer.should_skip(
        Path("vault/.obsidian/config.json"),
        Path("vault"),
        ignore_globs=[".obsidian/**"],
    )
    assert not indexer.should_skip(
        Path("vault/notes/x.md"),
        Path("vault"),
        ignore_globs=[".obsidian/**"],
    )


def test_should_skip_for_frontmatter_flag(tmp_path: Path):
    f = tmp_path / "skip.md"
    f.write_text("---\nsofia-index: false\n---\nbody")
    assert indexer.should_skip_by_frontmatter(f)

    f2 = tmp_path / "keep.md"
    f2.write_text("---\nsofia-index: true\n---\nbody")
    assert not indexer.should_skip_by_frontmatter(f2)

    f3 = tmp_path / "default.md"
    f3.write_text("body")
    assert not indexer.should_skip_by_frontmatter(f3)


def test_index_walks_vault_and_writes_chunks(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        stats = indexer.index_vault(
            conn=conn,
            vault=tmp_vault,
            embedder=stub_embedder,
            ignore_globs=[".obsidian/**"],
            chunk_max_tokens=512,
            chunk_overlap_tokens=64,
        )
        assert stats.indexed >= 4  # SOUL, USER, memory/personal, memory/work
        rows = conn.execute("SELECT path FROM documents ORDER BY path").fetchall()
        paths = {r[0] for r in rows}
        assert "_agent/SOUL.md" in paths
        assert "_agent/USER.md" in paths
        assert "_agent/memory/personal.md" in paths
        assert "_agent/memory/work.md" in paths
    finally:
        conn.close()


def test_incremental_skip_when_hash_unchanged(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        s1 = indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        # Touch mtime but don't change content.
        target = tmp_vault / "_agent" / "SOUL.md"
        future = time.time() + 60
        target.touch(exist_ok=True)
        import os
        os.utime(target, (future, future))

        s2 = indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        # Second run should be a no-op (skipped == total).
        assert s2.skipped >= s1.indexed - s2.indexed
    finally:
        conn.close()


def test_reindex_after_content_change(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        target = tmp_vault / "_agent" / "memory" / "personal.md"
        target.write_text(target.read_text() + "\n\n## new\nnew content here.\n")

        s2 = indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        assert s2.indexed >= 1
        # Content of the latest indexed document should reflect the new heading.
        chunks = conn.execute(
            "SELECT text FROM chunks WHERE doc_path = '_agent/memory/personal.md'"
        ).fetchall()
        text_blob = " ".join(c[0] for c in chunks)
        assert "new content here." in text_blob
    finally:
        conn.close()


def test_orphan_documents_removed(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        # Delete a file from the vault.
        (tmp_vault / "_agent" / "USER.md").unlink()

        indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
            prune_missing=True,
        )
        rows = conn.execute(
            "SELECT path FROM documents WHERE path = '_agent/USER.md'"
        ).fetchall()
        assert rows == []
    finally:
        conn.close()
