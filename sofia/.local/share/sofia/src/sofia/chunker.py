"""Markdown chunker.

Splits a markdown document into heading-aware chunks. The chunker uses
H1/H2/H3 boundaries, then sliding-windows any section that exceeds the
token budget. Each chunk carries its nearest heading so callers can
display it as snippet context.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


_TOKEN_RE = re.compile(r"\S+")
_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Chunk:
    idx: int
    heading: str
    text: str


def estimate_tokens(text: str) -> int:
    return len(_TOKEN_RE.findall(text))


def _split_by_headings(text: str) -> list[tuple[str, str]]:
    """Return [(heading, body), ...] in document order.

    Text above the first heading is returned with an empty heading.
    """
    sections: list[tuple[str, str]] = []
    matches = list(_HEADING_RE.finditer(text))

    if not matches:
        return [("", text)]

    if matches[0].start() > 0:
        prelude = text[: matches[0].start()].rstrip()
        if prelude:
            sections.append(("", prelude))

    for i, m in enumerate(matches):
        heading = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        sections.append((heading, body))

    return sections


def _window(body: str, max_tokens: int, overlap_tokens: int) -> list[str]:
    words = body.split()
    if len(words) <= max_tokens:
        return [body]
    step = max_tokens - overlap_tokens
    if step <= 0:
        raise ValueError("overlap_tokens must be < max_tokens")
    out: list[str] = []
    i = 0
    while i < len(words):
        out.append(" ".join(words[i : i + max_tokens]))
        if i + max_tokens >= len(words):
            break
        i += step
    return out


def chunk_markdown(
    text: str, *, max_tokens: int = 512, overlap_tokens: int = 64
) -> list[Chunk]:
    """Return a flat list of Chunks for the document."""
    sections = _split_by_headings(text)

    chunks: list[Chunk] = []
    idx = 0
    for heading, body in sections:
        if not body:
            continue
        for piece in _window(body, max_tokens, overlap_tokens):
            chunks.append(Chunk(idx=idx, heading=heading, text=piece))
            idx += 1
    return chunks
