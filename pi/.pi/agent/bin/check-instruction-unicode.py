"""Read-only hygiene for explicit instruction Markdown; not injection defense."""

import errno
import stat
import sys
import unicodedata
from pathlib import Path

ROOTS = (
    ("pi/.pi/agent/AGENTS.md", False),
    ("pi/.pi/agent/agents", True),
    ("pi/.pi/agent/prompts", True),
    ("pi/.pi/agent/skills", True),
    ("pi/.pi/agent/memory", True),
    ("claude/.claude/CLAUDE.md", False),
)
EXCLUDED = {
    ".git", ".cache", "__pycache__", "node_modules", ".venv", "venv",
    "auth", "env", "secret", "secrets", "sessions", "cache", "caches",
    "generated", "dist", "build", "coverage", "packages",
}
BIDI = {
    0x061C, 0x200E, 0x200F,
    *range(0x202A, 0x202F), *range(0x2066, 0x206A),
}


def _excluded(name):
    name = name.lower()
    return (
        name in EXCLUDED
        or name == ".env"
        or name.startswith(
            (".env.", "env.", "auth.", "secret.", "secrets.")
        )
    )


def scan(repo_root: Path) -> list[str]:
    repo = Path(repo_root).resolve()
    rows = []

    def report(path, message, line=1, column=1):
        label = ascii(path.relative_to(repo).as_posix())[1:-1]
        rows.append((label, line, column, message))

    def io_error(path, error):
        code = errno.errorcode.get(error.errno, "OSERROR")
        report(path, f"SCAN_ERROR cannot inspect/read path ({code})")

    def visit(path, directory=None):
        try:
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                report(path, "SCAN_ERROR symlink; use repository files")
                return
            is_directory = stat.S_ISDIR(mode)
            if directory is not None and directory != is_directory:
                expected = "directory" if directory else "file"
                report(path, f"SCAN_ERROR expected {expected}")
                return
            if is_directory:
                for child in path.iterdir():
                    if not _excluded(child.name):
                        visit(child)
                return
            if path.suffix.lower() != ".md":
                return
            if not stat.S_ISREG(mode):
                report(path, "SCAN_ERROR expected regular Markdown file")
                return
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            report(path, "SCAN_ERROR invalid UTF-8; save file as UTF-8")
            return
        except OSError as error:
            io_error(path, error)
            return
        line = column = 1
        for offset, char in enumerate(text):
            code = ord(char)
            forbidden = (
                code in BIDI
                or code in {0x200B, 0x2060}
                or (code == 0xFEFF and offset != 0)
                or (code < 0x20 and char not in "\t\r\n")
                or 0x7F <= code <= 0x9F
            )
            if forbidden:
                name = unicodedata.name(char, "CONTROL CHARACTER")
                report(path, f"U+{code:04X} {name}", line, column)
            if char == "\n":
                line, column = line + 1, 1
            else:
                column += 1

    for relative, directory in ROOTS:
        path = repo / relative
        try:
            resolved = path.resolve(strict=True)
        except OSError as error:
            io_error(path, error)
        except RuntimeError:
            report(path, "SCAN_ERROR symlink loop in required root")
        else:
            if resolved != path:
                report(path, "SCAN_ERROR symlink in required root path")
            else:
                visit(path, directory)
    return [
        f"{path}:{line}:{column}: {message}"
        for path, line, column, message in sorted(rows)
    ]


def main() -> int:
    if len(sys.argv) != 1:
        print(
            "Usage: python3 pi/.pi/agent/bin/"
            "check-instruction-unicode.py", file=sys.stderr,
        )
        return 1
    findings = scan(Path(__file__).resolve().parents[4])
    if findings:
        print("\n".join(findings), file=sys.stderr)
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
