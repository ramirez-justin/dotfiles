"""sofia — typer CLI entrypoint.

Subcommands:
  init     create DB, download embed model, smoke-test
  index    full / incremental walk; --rebuild drops the DB first
  search   hybrid search; outputs human or --json
  status   doc count, last index, oldest entry, DB size
  doctor   health check (model present, DB writable, fswatch alive)
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

import typer

from sofia import config as config_mod
from sofia import db
from sofia.embedder import Embedder
from sofia.indexer import index_vault, index_single_file
from sofia.search import hybrid_search


app = typer.Typer(no_args_is_help=True, add_completion=False, help="sofia second brain")


# ---------- helpers ----------

def _load_cfg() -> config_mod.Config:
    path = Path(os.environ.get("SOFIA_CONFIG") or config_mod.DEFAULT_CONFIG_PATH)
    return config_mod.load(path)


def _make_embedder(cfg: config_mod.Config):
    """Return a real Embedder, unless SOFIA_TEST_STUB_EMBEDDER=1 (test-only)."""
    if os.environ.get("SOFIA_TEST_STUB_EMBEDDER") == "1":
        # tiny deterministic stub matching dim=384
        class _Stub:
            dim = 384
            def embed(self, texts):
                return [[float(len(t)) % 7] + [0.0] * 383 for t in texts]
        return _Stub()
    return Embedder(cfg.embed_model, cache_dir=str(cfg.embed_cache_dir))


def _detect_context() -> str:
    explicit = os.environ.get("SOFIA_CONTEXT")
    if explicit:
        return explicit
    cwd = os.getcwd().lower()
    home = os.path.expanduser("~").lower()
    if cwd.startswith(f"{home}/telophaseqs") or ("/sofia/" in cwd and "/work/" in cwd):
        return "work"
    return "personal"


# ---------- subcommands ----------

@app.command()
def init() -> None:
    """Create DB, download embed model, smoke-test the pipeline."""
    cfg = _load_cfg()
    typer.echo(f"vault: {cfg.vault}")
    typer.echo(f"index db: {cfg.index_db}")
    cfg.index_db.parent.mkdir(parents=True, exist_ok=True)
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    cfg.embed_cache_dir.mkdir(parents=True, exist_ok=True)

    conn = db.connect(cfg.index_db)
    conn.close()
    typer.echo("DB schema OK.")

    embedder = _make_embedder(cfg)
    _ = embedder.embed(["smoke test"])  # forces download / loads weights
    typer.echo(f"Embedder OK (dim={embedder.dim}).")
    typer.echo("init complete. Next: `sofia index`.")


@app.command()
def index(
    rebuild: bool = typer.Option(False, "--rebuild", help="Drop DB before indexing."),
    incremental: bool = typer.Option(False, "--incremental", help="Skip docs whose mtime/hash are unchanged."),
    file: Optional[Path] = typer.Option(None, "--file", help="Index a single file (used by fswatch)."),
) -> None:
    """Walk the vault and update the index."""
    cfg = _load_cfg()
    if rebuild:
        db.reset(cfg.index_db)
        typer.echo("DB reset.")

    conn = db.connect(cfg.index_db)
    embedder = _make_embedder(cfg)

    try:
        if file is not None:
            did_work = index_single_file(
                conn=conn, vault=cfg.vault, md_path=file.resolve(),
                embedder=embedder,
                ignore_globs=cfg.ignore_globs,
                chunk_max_tokens=cfg.chunk_max_tokens,
                chunk_overlap_tokens=cfg.chunk_overlap_tokens,
            )
            typer.echo(f"single-file index: {'updated' if did_work else 'no change'} ({file})")
            return

        stats = index_vault(
            conn=conn, vault=cfg.vault, embedder=embedder,
            ignore_globs=cfg.ignore_globs,
            chunk_max_tokens=cfg.chunk_max_tokens,
            chunk_overlap_tokens=cfg.chunk_overlap_tokens,
            prune_missing=not incremental,
        )
        typer.echo(f"indexed: {stats.indexed}, skipped: {stats.skipped}, pruned: {stats.pruned}")

        # Update state file
        cfg.state_dir.mkdir(parents=True, exist_ok=True)
        (cfg.state_dir / "state.json").write_text(json.dumps({
            "last_index_at": int(time.time()),
            "last_indexed": stats.indexed,
            "last_skipped": stats.skipped,
            "last_pruned": stats.pruned,
        }))
    finally:
        conn.close()


@app.command()
def search(
    query: str = typer.Argument(..., help="Natural language or keyword query."),
    context: Optional[str] = typer.Option(None, "--context", help="personal | work | both"),
    type_: Optional[str] = typer.Option(None, "--type", help="memory | daily | plan | inbox | project"),
    limit: int = typer.Option(20, "--limit", help="Max results."),
    output_json: bool = typer.Option(False, "--json", help="Emit JSON instead of human text."),
) -> None:
    """Hybrid search."""
    cfg = _load_cfg()
    ctx = context or _detect_context()
    conn = db.connect(cfg.index_db)
    embedder = _make_embedder(cfg)
    try:
        results = hybrid_search(
            conn=conn, embedder=embedder,
            query=query, limit=limit, context=ctx, doc_type=type_,
            vec_weight=cfg.vec_weight, fts_weight=cfg.fts_weight,
        )
    finally:
        conn.close()

    if output_json:
        typer.echo(json.dumps([
            {
                "path": r.path, "heading": r.heading, "snippet": r.snippet,
                "score": r.score, "context": r.context, "type": r.type,
            } for r in results
        ]))
        return

    if not results:
        typer.echo("(no results)")
        return
    for i, r in enumerate(results, 1):
        typer.echo(f"{i:>2}. {r.path}  [{r.context or '-'}/{r.type or '-'}]  score={r.score:.3f}")
        if r.heading:
            typer.echo(f"     ## {r.heading}")
        typer.echo(f"     {r.snippet}")


@app.command()
def status() -> None:
    """Index stats."""
    cfg = _load_cfg()
    if not cfg.index_db.exists():
        typer.echo("no index yet — run `sofia init` then `sofia index`.")
        raise typer.Exit(code=1)
    conn = db.connect(cfg.index_db)
    try:
        docs = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        oldest = conn.execute("SELECT MIN(indexed_at) FROM documents").fetchone()[0]
        newest = conn.execute("SELECT MAX(indexed_at) FROM documents").fetchone()[0]
    finally:
        conn.close()
    size_bytes = cfg.index_db.stat().st_size
    typer.echo(f"documents: {docs}")
    typer.echo(f"chunks: {chunks}")
    typer.echo(f"db size: {size_bytes/1024:.1f} KB")
    if oldest:
        typer.echo(f"oldest indexed_at: {time.strftime('%Y-%m-%d %H:%M', time.localtime(oldest))}")
    if newest:
        typer.echo(f"newest indexed_at: {time.strftime('%Y-%m-%d %H:%M', time.localtime(newest))}")


@app.command()
def doctor() -> None:
    """Health check: vault reachable, DB writable, fswatch agent loaded."""
    cfg = _load_cfg()
    ok = True

    if not cfg.vault.exists():
        typer.echo(f"FAIL: vault not found at {cfg.vault}")
        ok = False
    else:
        typer.echo(f"OK: vault at {cfg.vault}")

    try:
        conn = db.connect(cfg.index_db)
        conn.close()
        typer.echo(f"OK: DB at {cfg.index_db}")
    except Exception as e:
        typer.echo(f"FAIL: DB error: {e}")
        ok = False

    plist_path = Path.home() / "Library/LaunchAgents/com.sofia.indexer.plist"
    if plist_path.exists():
        typer.echo(f"OK: LaunchAgent plist present at {plist_path}")
    else:
        typer.echo(f"WARN: LaunchAgent plist not found ({plist_path})")

    if not ok:
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
