#!/usr/bin/env bash
set -euo pipefail

repo_root="${DOTFILES_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$repo_root"

failed=0

# Paths that Hermes may generate locally but should never be committed.
# .env.example is intentionally allowed; real .env files are not.
forbidden_path_re='(^|/)\.env$|(^|/)auth\.json$|(^|/)state\.db$|(^|/)(logs|sessions|memories|cron|checkpoints)(/|$)'

check_paths() {
  local label="$1"
  shift
  local paths
  paths="$({ "$@" || true; } | grep -E "$forbidden_path_re" | grep -vE '(^|/)\.env\.example$' || true)"
  if [ -n "$paths" ]; then
    echo "Refusing to commit Hermes local state/secrets from $label:" >&2
    printf '%s\n' "$paths" | sed 's/^/  /' >&2
    failed=1
  fi
}

check_paths "tracked files" git ls-files
check_paths "staged files" git diff --cached --name-only --diff-filter=ACMRT

python3 - <<'PY'
import re
import subprocess
import sys
from pathlib import Path

# Scan only files staged for this commit. Existing historical files may contain
# false positives; this guard's job is to stop newly staged leaks.
paths = set(subprocess.check_output(
    ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRT"],
    text=True,
).splitlines())
paths = {p for p in paths if p and Path(p).is_file()}

secret_patterns = {
    "private key block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----"),
    "OpenAI-style key": re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b"),
    "GitHub token": re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{32,}\b"),
    "JWT-like token": re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"),
    "long assigned secret": re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?key|secret|token|password)\b\s*[:=]\s*[\"']?([A-Za-z0-9_./+=-]{32,})"),
}

allow_markers = (
    "op://",
    "${",
    "REPLACE_ME",
    "PLACEHOLDER",
    "example",
    "EXAMPLE",
    "<",
)

findings = []
for path in sorted(paths):
    try:
        data = Path(path).read_bytes()
    except OSError:
        continue
    if b"\0" in data[:4096]:
        continue
    text = data.decode("utf-8", "ignore")
    for name, pattern in secret_patterns.items():
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            snippet = match.group(0)
            if any(marker in snippet for marker in allow_markers):
                continue
            findings.append((path, line, name))

if findings:
    print("Potential committed secret material detected:", file=sys.stderr)
    for path, line, name in findings:
        print(f"  {path}:{line}: {name}", file=sys.stderr)
    sys.exit(1)
PY

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "Hermes sensitive-state guard passed"
