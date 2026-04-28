"""Hybrid search.

Returns ranked results combining sqlite-vec (cosine-like distance) and
FTS5 (BM25) scores with configurable weights.
"""
from __future__ import annotations

import re
import sqlite3
import struct
from dataclasses import dataclass


@dataclass(frozen=True)
class SearchResult:
    path: str
    heading: str
    snippet: str
    score: float
    context: str | None
    type: str | None


_FTS_SAFE_RE = re.compile(r"[^A-Za-z0-9_\s]")


def _sanitize_fts5(query: str) -> str:
    """Strip characters that have FTS5 syntax meaning. Quote multi-word."""
    cleaned = _FTS_SAFE_RE.sub(" ", query).strip()
    if not cleaned:
        return '""'
    # Wrap each token in quotes and AND them. Robust against punctuation.
    tokens = cleaned.split()
    return " ".join(f'"{t}"' for t in tokens)


def _serialize_vec(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _normalize(scores: dict[int, float]) -> dict[int, float]:
    if not scores:
        return {}
    lo = min(scores.values())
    hi = max(scores.values())
    if hi == lo:
        return {k: 1.0 for k in scores}
    return {k: (v - lo) / (hi - lo) for k, v in scores.items()}


def _make_snippet(text: str, query: str, width: int = 200) -> str:
    if not query:
        return text[:width]
    q = query.lower().split()[0] if query.split() else query.lower()
    pos = text.lower().find(q)
    if pos < 0:
        return (text[:width] + ("…" if len(text) > width else ""))
    start = max(0, pos - width // 2)
    end = min(len(text), start + width)
    snippet = text[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet


def hybrid_search(
    *,
    conn: sqlite3.Connection,
    embedder,
    query: str,
    limit: int = 20,
    context: str | None = None,
    doc_type: str | None = None,
    vec_weight: float = 0.7,
    fts_weight: float = 0.3,
) -> list[SearchResult]:
    """Return up to `limit` ranked results."""
    if not query.strip():
        return []

    # ---- vector side ----
    qvec = embedder.embed([query])[0]
    vec_rows = conn.execute(
        """
        SELECT chunk_id, distance
        FROM chunks_vec
        WHERE embedding MATCH ? AND k = 50
        ORDER BY distance
        """,
        (_serialize_vec(qvec),),
    ).fetchall()
    # smaller distance = closer; flip to similarity-like: 1 / (1 + d)
    vec_scores = {cid: 1.0 / (1.0 + d) for cid, d in vec_rows}

    # ---- fts side ----
    fts_query = _sanitize_fts5(query)
    fts_rows = conn.execute(
        """
        SELECT rowid, bm25(chunks_fts) AS rank
        FROM chunks_fts
        WHERE chunks_fts MATCH ?
        LIMIT 50
        """,
        (fts_query,),
    ).fetchall()
    # bm25() returns lower = better; flip via 1 / (1 + rank)
    fts_scores = {rid: 1.0 / (1.0 + abs(rank)) for rid, rank in fts_rows}

    # ---- blend ----
    vec_norm = _normalize(vec_scores)
    fts_norm = _normalize(fts_scores)
    blended: dict[int, float] = {}
    for cid, s in vec_norm.items():
        blended[cid] = blended.get(cid, 0.0) + vec_weight * s
    for cid, s in fts_norm.items():
        blended[cid] = blended.get(cid, 0.0) + fts_weight * s

    if not blended:
        return []

    # Hydrate. Apply context/type filter via a single SQL query.
    placeholders = ",".join("?" * len(blended))
    args: list = list(blended.keys())
    sql = f"""
        SELECT c.id, c.doc_path, c.heading, c.text, d.context, d.type, d.mtime
        FROM chunks c
        JOIN documents d ON d.path = c.doc_path
        WHERE c.id IN ({placeholders})
    """
    if context and context != "both":
        sql += " AND (d.context = ? OR d.context = 'universal')"
        args.append(context)
    if doc_type:
        sql += " AND d.type = ?"
        args.append(doc_type)

    rows = conn.execute(sql, args).fetchall()

    results = [
        SearchResult(
            path=path,
            heading=heading or "",
            snippet=_make_snippet(text, query),
            score=blended[cid] + (mtime / 1e12 if mtime else 0),  # mtime tiebreak
            context=ctx,
            type=typ,
        )
        for cid, path, heading, text, ctx, typ, mtime in rows
    ]
    results.sort(key=lambda r: r.score, reverse=True)
    return results[:limit]
