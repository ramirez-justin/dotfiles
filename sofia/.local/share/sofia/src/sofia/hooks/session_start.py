"""SessionStart hook implementation.

Reads SOUL.md, USER.md, memory/shared.md, and memory/{context}.md,
applies a size budget, and emits a JSON payload that Claude Code injects as
additional context.

Failure modes are non-fatal: a missing file or unreadable vault yields a
minimal payload instead of an error.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


_ENTRY_RE = re.compile(r"(?=^## )", re.MULTILINE)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            return text[end + 4 :].lstrip("\n")
    return text


def _truncate_memory(memory_text: str, max_entries: int) -> str:
    """Keep only the top `max_entries` `## …` sections (newest-first ordering)."""
    body = _strip_frontmatter(memory_text)
    # Find header line and keep first N entries below it.
    lines = body.splitlines(keepends=True)
    header_lines: list[str] = []
    rest_lines: list[str] = []
    seen_first_h2 = False
    for line in lines:
        if not seen_first_h2 and line.startswith("## "):
            seen_first_h2 = True
        if seen_first_h2:
            rest_lines.append(line)
        else:
            header_lines.append(line)
    rest = "".join(rest_lines)
    parts = _ENTRY_RE.split(rest)
    parts = [p for p in parts if p.strip()]
    parts = parts[:max_entries]
    return "".join(header_lines) + "".join(parts)


def build_payload(
    *, vault: Path, context: str, max_chars: int, memory_max_entries: int
) -> str:
    soul = _read(vault / "_agent" / "SOUL.md")
    user = _read(vault / "_agent" / "USER.md")
    shared_memory = _read(vault / "_agent" / "memory" / "shared.md")
    shared_memory_trim = (
        _truncate_memory(shared_memory, memory_max_entries) if shared_memory else ""
    )
    memory_path = vault / "_agent" / "memory" / f"{context}.md"
    memory = _read(memory_path)
    memory_trim = _truncate_memory(memory, memory_max_entries) if memory else ""

    sections = []
    sections.append(f"# SOFIA — your second brain context (context: {context})")
    if soul.strip():
        sections.append(f"## SOUL (identity + rules)\n\n{_strip_frontmatter(soul).strip()}")
    if user.strip():
        sections.append(f"## USER (profile)\n\n{_strip_frontmatter(user).strip()}")
    if shared_memory_trim.strip():
        sections.append(
            f"## SHARED MEMORY (always loaded)\n\n{shared_memory_trim.strip()}"
        )
    if memory_trim.strip():
        sections.append(
            f"## CONTEXT MEMORY ({context})\n\n{memory_trim.strip()}"
        )
    footer = (
        f"\n---\n"
        f"Vault: {vault}\n"
        f"For full memory, search with `sofia-search` or read the files directly."
    )

    payload = "\n\n".join(sections) + footer

    if len(payload) > max_chars:
        # Hard truncate. Preserve footer if budget allows; otherwise plain trim.
        if max_chars > len(footer):
            payload = payload[: max_chars - len(footer)] + footer
        else:
            payload = payload[:max_chars]
    return payload


def emit(*, vault: Path, context: str, max_chars: int, memory_max_entries: int) -> None:
    """Print Claude-Code-shaped JSON to stdout."""
    try:
        payload = build_payload(
            vault=vault, context=context,
            max_chars=max_chars, memory_max_entries=memory_max_entries,
        )
    except Exception:
        payload = ""

    out = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": payload,
        }
    }
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()


def main() -> None:
    """Read context + cfg from env (set by the bash wrapper) and emit."""
    import os
    from sofia import config as config_mod

    vault = Path(os.environ.get("SOFIA_VAULT", "")).expanduser()
    context = os.environ.get("SOFIA_CTX", "personal")
    if context == "both":
        context = "personal"

    try:
        cfg = config_mod.load(Path(os.environ.get("SOFIA_CONFIG") or config_mod.DEFAULT_CONFIG_PATH))
        max_chars = cfg.session_start_max_chars
        max_entries = cfg.memory_max_entries
    except Exception:
        max_chars = 32000
        max_entries = 20

    emit(vault=vault, context=context, max_chars=max_chars, memory_max_entries=max_entries)


if __name__ == "__main__":
    main()
