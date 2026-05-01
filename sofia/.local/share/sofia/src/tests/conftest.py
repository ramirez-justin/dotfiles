"""Shared pytest fixtures for the sofia test suite."""
from __future__ import annotations

import textwrap
from pathlib import Path

import pytest


@pytest.fixture
def tmp_vault(tmp_path: Path) -> Path:
    """Create a minimal SOFIA-shaped vault for indexer/search tests."""
    vault = tmp_path / "vault"
    (vault / "_agent" / "memory").mkdir(parents=True)
    (vault / "_agent" / "daily" / "personal").mkdir(parents=True)
    (vault / "_agent" / "daily" / "work").mkdir(parents=True)
    (vault / "_agent" / "plans" / "personal").mkdir(parents=True)
    (vault / "_agent" / "plans" / "work").mkdir(parents=True)
    (vault / "inbox").mkdir()
    (vault / "projects").mkdir()

    (vault / "_agent" / "SOUL.md").write_text(textwrap.dedent("""\
        ---
        type: soul
        context: universal
        agent-managed: true
        last-touched: 2026-04-28
        sofia-index: true
        ---
        # SOUL
        Test agent identity.
        """))

    (vault / "_agent" / "USER.md").write_text(textwrap.dedent("""\
        ---
        type: user
        context: universal
        agent-managed: true
        ---
        # USER
        ## Personal
        Test user, personal facet.
        ## Work
        Test user, work facet.
        """))

    (vault / "_agent" / "memory" / "shared.md").write_text(textwrap.dedent("""\
        ---
        type: memory
        context: shared
        agent-managed: true
        ---
        # Shared Memory

        ## Boot Policy
        Always load this shared memory before context-specific memory.
        """))

    (vault / "_agent" / "memory" / "personal.md").write_text(textwrap.dedent("""\
        ---
        type: memory
        context: personal
        agent-managed: true
        ---
        # Personal Memory

        ## 2026-04-27 · decision
        Decided to use uv. Source: [[daily/personal/2026-04-27#16-30]]
        """))

    (vault / "_agent" / "memory" / "work.md").write_text(textwrap.dedent("""\
        ---
        type: memory
        context: work
        agent-managed: true
        ---
        # Work Memory

        ## 2026-04-27 · lesson
        Quarterly reviews need 2 weeks lead time. Source: [[daily/work/2026-04-27#10-15]]
        """))

    return vault


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    """Path for a fresh sqlite DB; not yet created."""
    return tmp_path / "index.db"


@pytest.fixture
def env_vault(monkeypatch: pytest.MonkeyPatch, tmp_vault: Path) -> Path:
    """Set SOFIA_VAULT to the tmp vault for the duration of the test."""
    monkeypatch.setenv("SOFIA_VAULT", str(tmp_vault))
    return tmp_vault
