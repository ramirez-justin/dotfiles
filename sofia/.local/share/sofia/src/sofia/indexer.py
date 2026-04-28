"""Vault indexer.

Walks a vault directory, applies the ignore-list, dedups by content hash,
chunks the markdown, embeds the chunks, and upserts them into the SQLite
database. Idempotent: running twice on unchanged content is a no-op.
"""
from __future__ import annotations

import fnmatch
import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import frontmatter

from sofia import db
from sofia.chunker import chunk_markdown


@dataclass
class IndexStats:
    indexed: int = 0
    skipped: int = 0
    pruned: int = 0


# ---------- public predicates ----------

def should_skip(path: Path, vault: Path, ignore_globs: Iterable[str]) -> bool:
    rel = path.relative_to(vault).as_posix()
    return any(fnmatch.fnmatch(rel, g) for g in ignore_globs)


def should_skip_by_frontmatter(path: Path) -> bool:
    try:
        post = frontmatter.load(path)
    except Exception:
        return False
    val = post.metadata.get("sofia-index", True)
    if isinstance(val, bool):
        return not val
    if isinstance(val, str):
        return val.strip().lower() in {"false", "no", "0"}
    return False


# ---------- helpers ----------

def _file_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _classify_type(rel_path: str) -> str | None:
    """Best-effort document-type label, used as a search filter."""
    if rel_path == "_agent/SOUL.md":
        return "soul"
    if rel_path == "_agent/USER.md":
        return "user"
    if rel_path.startswith("_agent/memory/"):
        return "memory"
    if rel_path.startswith("_agent/daily/"):
        return "daily"
    if rel_path.startswith("_agent/plans/"):
        return "plan"
    if rel_path.startswith("inbox/"):
        return "inbox"
    if rel_path.startswith("projects/"):
        return "project"
    return "other"


def _classify_context(rel_path: str, frontmatter_context: str | None) -> str | None:
    if frontmatter_context:
        return frontmatter_context
    if "/personal/" in rel_path or rel_path.endswith("/personal.md"):
        return "personal"
    if "/work/" in rel_path or rel_path.endswith("/work.md"):
        return "work"
    return "universal"


# ---------- main entrypoint ----------

def index_vault(
    *,
    conn: sqlite3.Connection,
    vault: Path,
    embedder,
    ignore_globs: Iterable[str],
    chunk_max_tokens: int,
    chunk_overlap_tokens: int,
    prune_missing: bool = False,
) -> IndexStats:
    stats = IndexStats()
    seen_paths: set[str] = set()

    for md_path in sorted(vault.rglob("*.md")):
        if should_skip(md_path, vault, ignore_globs):
            continue
        if should_skip_by_frontmatter(md_path):
            continue

        rel = md_path.relative_to(vault).as_posix()
        seen_paths.add(rel)

        try:
            raw = md_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            stats.skipped += 1
            continue

        h = _file_hash(raw)
        existing = db.get_document_hash(conn, rel)
        if existing == h:
            stats.skipped += 1
            continue

        post = frontmatter.loads(raw)
        body = post.content
        chunks = chunk_markdown(
            body,
            max_tokens=chunk_max_tokens,
            overlap_tokens=chunk_overlap_tokens,
        )

        if not chunks:
            stats.skipped += 1
            continue

        embeddings = embedder.embed([c.text for c in chunks])
        chunk_rows = [
            db.ChunkRow(idx=c.idx, heading=c.heading, text=c.text, embedding=emb)
            for c, emb in zip(chunks, embeddings)
        ]

        db.upsert_document(
            conn,
            path=rel,
            context=_classify_context(rel, post.metadata.get("context")),
            doc_type=post.metadata.get("type") or _classify_type(rel),
            mtime=int(md_path.stat().st_mtime),
            content_hash=h,
            chunks=chunk_rows,
        )
        stats.indexed += 1

    if prune_missing:
        rows = conn.execute("SELECT path FROM documents").fetchall()
        for (p,) in rows:
            if p not in seen_paths:
                db.delete_document(conn, p)
                stats.pruned += 1

    return stats


def index_single_file(
    *,
    conn: sqlite3.Connection,
    vault: Path,
    md_path: Path,
    embedder,
    ignore_globs: Iterable[str],
    chunk_max_tokens: int,
    chunk_overlap_tokens: int,
) -> bool:
    """Re-index one file (for incremental triggered by fswatch). Returns True if work was done."""
    if not md_path.exists():
        # File was deleted — remove from index.
        rel = md_path.relative_to(vault).as_posix()
        db.delete_document(conn, rel)
        return True

    if should_skip(md_path, vault, ignore_globs):
        return False
    if should_skip_by_frontmatter(md_path):
        return False

    rel = md_path.relative_to(vault).as_posix()
    raw = md_path.read_text(encoding="utf-8")
    h = _file_hash(raw)
    if db.get_document_hash(conn, rel) == h:
        return False

    post = frontmatter.loads(raw)
    chunks = chunk_markdown(
        post.content,
        max_tokens=chunk_max_tokens,
        overlap_tokens=chunk_overlap_tokens,
    )
    if not chunks:
        return False

    embeddings = embedder.embed([c.text for c in chunks])
    chunk_rows = [
        db.ChunkRow(idx=c.idx, heading=c.heading, text=c.text, embedding=emb)
        for c, emb in zip(chunks, embeddings)
    ]
    db.upsert_document(
        conn,
        path=rel,
        context=_classify_context(rel, post.metadata.get("context")),
        doc_type=post.metadata.get("type") or _classify_type(rel),
        mtime=int(md_path.stat().st_mtime),
        content_hash=h,
        chunks=chunk_rows,
    )
    return True
