"""Exercise read-only instruction Markdown hygiene on local fixtures."""

import errno
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / "pi/.pi/agent/bin/check-instruction-unicode.py"
SPEC = importlib.util.spec_from_file_location("instruction_unicode", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class InstructionUnicodeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.outside = Path(temporary.name).resolve()
        self.repo = self.outside / "repo"
        for relative in (
            "pi/.pi/agent/AGENTS.md",
            "claude/.claude/CLAUDE.md",
        ):
            path = self.repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("", encoding="utf-8")
        for name in ("agents", "prompts", "skills", "memory"):
            (self.repo / "pi/.pi/agent" / name).mkdir()
        self.path = self.repo / "pi/.pi/agent/AGENTS.md"

    def test_directional_diagnostic_never_echoes_source(self):
        self.path.write_text("PRIVATE \u202e payload", encoding="utf-8")
        self.assertEqual(
            CHECKER.scan(self.repo),
            ["pi/.pi/agent/AGENTS.md:1:9: U+202E RIGHT-TO-LEFT OVERRIDE"],
        )

    def write(self, relative, content):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        data = content.encode("utf-8") if isinstance(content, str) else content
        path.write_bytes(data)
        return path

    def snapshot(self):
        return {
            path.relative_to(self.repo).as_posix(): path.read_bytes()
            for path in self.repo.rglob("*")
            if path.is_file() and not path.is_symlink()
        }

    def assert_scan_error(self, relative, detail):
        rows = CHECKER.scan(self.repo)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(f"{relative}:1:1: SCAN_ERROR"))
        self.assertIn(detail, rows[0])
        self.assertNotIn("FAKE_PRIVATE_SENTINEL", rows[0])
        return rows[0]

    def test_each_forbidden_category_has_one_content_free_finding(self):
        # Independent contract, not the production classifier or constants.
        codes = [
            0x061C, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C,
            0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069,
            0x200B, 0x2060, 0xFEFF,
            *range(0x09), *range(0x0B, 0x0D),
            *range(0x0E, 0x20), *range(0x7F, 0xA0),
        ]
        for code in codes:
            with self.subTest(code=f"U+{code:04X}"):
                self.path.write_text(
                    "PRIVATE " + chr(code) + " payload", encoding="utf-8"
                )
                before = self.path.read_bytes()
                rows = CHECKER.scan(self.repo)
                self.assertEqual(len(rows), 1)
                self.assertTrue(rows[0].startswith(
                    f"pi/.pi/agent/AGENTS.md:1:9: U+{code:04X} "
                ))
                self.assertNotIn("PRIVATE", rows[0])
                self.assertNotIn("payload", rows[0])
                self.assertEqual(self.path.read_bytes(), before)

    def test_names_and_control_fallback(self):
        for char, name in (
            ("\u202e", "RIGHT-TO-LEFT OVERRIDE"),
            ("\u200b", "ZERO WIDTH SPACE"),
            ("\x00", "CONTROL CHARACTER"),
        ):
            with self.subTest(name=name):
                self.path.write_text("x" + char, encoding="utf-8")
                self.assertEqual(CHECKER.scan(self.repo), [
                    f"pi/.pi/agent/AGENTS.md:1:2: U+{ord(char):04X} {name}"
                ])

    def test_legitimate_unicode_and_unchecked_tags_are_allowed(self):
        # Tags are intentionally unchecked, including isolated tag letters.
        text = (
            "\ufeff\t\n\r\r\né中\u200c\u200d\ufe0f\U000e0100"
            "\U0001f44d\U0001f3fd\U0001f469\u200d\U0001f4bb"
            "\U0001f3f4\U000e0067\U000e0062\U000e0065"
            "\U000e006e\U000e0067\U000e007f\U000e0061"
        )
        self.path.write_bytes(text.encode("utf-8"))
        before = self.snapshot()
        self.assertEqual(CHECKER.scan(self.repo), [])
        self.assertEqual(self.snapshot(), before)

    def test_bom_is_only_allowed_at_offset_zero(self):
        for text, location in (("\ufeff\ufeff", "1:2"), ("\n\ufeff", "2:1")):
            with self.subTest(location=location):
                self.path.write_bytes(text.encode("utf-8"))
                before = self.path.read_bytes()
                self.assertEqual(CHECKER.scan(self.repo), [
                    (f"pi/.pi/agent/AGENTS.md:{location}: "
                     "U+FEFF ZERO WIDTH NO-BREAK SPACE")
                ])
                self.assertEqual(self.path.read_bytes(), before)

    def test_positions_numeric_order_and_repeated_scan(self):
        self.write("pi/.pi/agent/agents/a.md", "é\r\n中\ufeff\rx\x07\n")
        self.write("pi/.pi/agent/agents/b.md", "a\u200b" * 6)
        before = self.snapshot()
        expected = [
            ("pi/.pi/agent/agents/a.md:2:2: "
             "U+FEFF ZERO WIDTH NO-BREAK SPACE"),
            "pi/.pi/agent/agents/a.md:3:2: U+0007 CONTROL CHARACTER",
        ] + [
            f"pi/.pi/agent/agents/b.md:1:{column}: U+200B ZERO WIDTH SPACE"
            for column in (2, 4, 6, 8, 10, 12)
        ]
        self.assertEqual(CHECKER.scan(self.repo), expected)
        self.assertEqual(CHECKER.scan(self.repo), expected)
        self.assertEqual(self.snapshot(), before)

    def test_all_explicit_roots_include_untracked_nested_markdown(self):
        paths = (
            "pi/.pi/agent/AGENTS.md",
            "pi/.pi/agent/agents/nested/a.MD",
            "pi/.pi/agent/prompts/p.md",
            "pi/.pi/agent/skills/new/SKILL.md",
            "pi/.pi/agent/memory/projects/project.md",
            "claude/.claude/CLAUDE.md",
        )
        for relative in paths:
            self.write(relative, "\u200b")
        self.assertEqual(CHECKER.scan(self.repo), [
            f"{relative}:1:1: U+200B ZERO WIDTH SPACE"
            for relative in sorted(paths)
        ])
        self.assertFalse((self.repo / ".git").exists())

    def test_excluded_and_unrelated_sources_are_never_read(self):
        # Literal policy cases ensure a dropped exclusion is detected.
        directories = (
            ".git", ".cache", "__pycache__", "node_modules", ".venv",
            "venv", "auth", "env", "secret", "secrets", "sessions",
            "cache", "caches", "generated", "dist", "build", "coverage",
            "packages", "SECRETS", ".env", ".env.local", "env.local",
            "auth.private", "secret.private", "secrets.private",
        )
        ignored = []
        for name in directories:
            ignored.append(self.write(
                f"pi/.pi/agent/skills/{name}/probe.md", b"\xff"
            ))
        for name in (
            ".env.md", ".env.local.md", "env.local.md", "auth.md",
            "secret.md", "secrets.md", "auth.json", "photo.png", "notes.txt",
        ):
            ignored.append(self.write(f"pi/.pi/agent/skills/{name}", b"\xff"))
        for relative in (
            "README.md", "pi/.pi/agent/extensions/probe.md",
            "claude/.claude/other.md",
        ):
            ignored.append(self.write(relative, b"\xff"))
        before = self.snapshot()
        original = Path.read_text

        def guarded(path, *args, **kwargs):
            if path in ignored:
                raise AssertionError("excluded source was read")
            return original(path, *args, **kwargs)

        with mock.patch.object(Path, "read_text", guarded):
            self.assertEqual(CHECKER.scan(self.repo), [])
        self.assertEqual(self.snapshot(), before)

    def test_path_labels_are_ascii_escaped_without_source_text(self):
        relative = "pi/.pi/agent/agents/a\n\u202eé.md"
        self.write(relative, "PRIVATE \u200b payload")
        self.assertEqual(CHECKER.scan(self.repo), [
            ("pi/.pi/agent/agents/a\\n\\u202e\\xe9.md:1:9: "
             "U+200B ZERO WIDTH SPACE")
        ])

    def test_links_are_rejected_without_reading_targets(self):
        internal = self.write("pi/.pi/agent/agents/target.md", "safe")
        external = self.outside / "FAKE_PRIVATE_SENTINEL.md"
        external.write_bytes(b"\xff")
        external_dir = self.outside / "FAKE_PRIVATE_SENTINEL"
        external_dir.mkdir()
        (external_dir / "probe.md").write_bytes(b"\xff")
        link = self.repo / "pi/.pi/agent/skills/link"
        targets = (
            internal, internal.parent, external, external_dir,
            self.outside / "FAKE_PRIVATE_SENTINEL-missing", link,
        )
        original = Path.read_text

        def guarded(path, *args, **kwargs):
            if path == link or not path.is_relative_to(self.repo):
                raise AssertionError("link target was read")
            return original(path, *args, **kwargs)

        for target in targets:
            with self.subTest(target=target.name):
                link.symlink_to(target)
                try:
                    with mock.patch.object(Path, "read_text", guarded):
                        self.assert_scan_error(
                            "pi/.pi/agent/skills/link", "symlink"
                        )
                finally:
                    link.unlink()
        # Excluded links are skipped before inspection as well as reading.
        excluded = link.with_name("secrets")
        excluded.symlink_to(external_dir)
        with mock.patch.object(Path, "read_text", guarded):
            self.assertEqual(CHECKER.scan(self.repo), [])

    def test_required_root_links_and_linked_ancestors_fail_closed(self):
        for relative in (
            "pi/.pi/agent/AGENTS.md", "pi/.pi/agent/agents",
            "pi/.pi/agent", "pi/.pi", "pi",
        ):
            with self.subTest(relative=relative):
                path = self.repo / relative
                target = self.outside / "FAKE_PRIVATE_SENTINEL-moved"
                path.rename(target)
                path.symlink_to(target)
                original = Path.read_text

                def guarded(candidate, *args, root=path, read=original, **kwargs):
                    if candidate.is_relative_to(root):
                        raise AssertionError("linked root was read")
                    return read(candidate, *args, **kwargs)

                try:
                    with mock.patch.object(Path, "read_text", guarded):
                        rows = CHECKER.scan(self.repo)
                    self.assertTrue(rows)
                    self.assertTrue(all("SCAN_ERROR" in row for row in rows))
                    self.assertTrue(all("symlink" in row for row in rows))
                    self.assertNotIn("FAKE_PRIVATE_SENTINEL", "\n".join(rows))
                finally:
                    path.unlink()
                    target.rename(path)

    def test_required_root_loop_is_sanitized(self):
        self.path.unlink()
        self.path.symlink_to(self.path)
        self.assert_scan_error("pi/.pi/agent/AGENTS.md", "SCAN_ERROR")

    def test_missing_and_wrong_type_required_roots_fail(self):
        self.path.unlink()
        self.assert_scan_error("pi/.pi/agent/AGENTS.md", "ENOENT")
        self.path.mkdir()
        self.assert_scan_error("pi/.pi/agent/AGENTS.md", "expected file")
        self.path.rmdir()
        self.path.write_text("", encoding="utf-8")
        directory = self.repo / "pi/.pi/agent/agents"
        directory.rmdir()
        directory.write_text("", encoding="utf-8")
        self.assert_scan_error("pi/.pi/agent/agents", "expected directory")

    def test_fifo_markdown_is_not_opened(self):
        path = self.repo / "pi/.pi/agent/agents/probe.md"
        os.mkfifo(path)
        original = Path.read_text

        def guarded(candidate, *args, **kwargs):
            if candidate == path:
                raise AssertionError("FIFO was opened")
            return original(candidate, *args, **kwargs)

        with mock.patch.object(Path, "read_text", guarded):
            self.assert_scan_error(
                "pi/.pi/agent/agents/probe.md", "regular Markdown file"
            )

    def test_filesystem_errors_are_sanitized(self):
        for operation, relative in (
            ("lstat", "pi/.pi/agent/agents/probe.md"),
            ("iterdir", "pi/.pi/agent/agents"),
            ("read_text", "pi/.pi/agent/AGENTS.md"),
            ("resolve", "pi/.pi/agent/AGENTS.md"),
        ):
            with self.subTest(operation=operation):
                probe = self.write("pi/.pi/agent/agents/probe.md", "safe")
                target = self.repo / relative
                original = getattr(Path, operation)

                def failing(path, *args, target=target, call=original, **kwargs):
                    if path == target:
                        raise PermissionError(
                            errno.EACCES, "FAKE_PRIVATE_SENTINEL", str(target)
                        )
                    return call(path, *args, **kwargs)

                with mock.patch.object(Path, operation, failing):
                    self.assert_scan_error(relative, "EACCES")
                probe.unlink()

    def test_invalid_utf8_never_echoes_bytes(self):
        self.path.write_bytes(b"FAKE_PRIVATE_SENTINEL\xff")
        self.assert_scan_error("pi/.pi/agent/AGENTS.md", "invalid UTF-8")

    def test_cli_uses_script_location_and_never_writes(self):
        script = self.repo / "pi/.pi/agent/bin" / SCRIPT.name
        script.parent.mkdir()
        shutil.copyfile(SCRIPT, script)

        def run(*args):
            return subprocess.run(
                [sys.executable, "-B", str(script), *args],
                cwd=self.outside, capture_output=True, text=True, timeout=10,
                check=False,
            )

        before = self.snapshot()
        clean = run()
        self.assertEqual((clean.returncode, clean.stdout, clean.stderr),
                         (0, "", ""))
        self.assertEqual(self.snapshot(), before)
        self.path.write_text("PRIVATE \u202e payload", encoding="utf-8")
        before = self.snapshot()
        planted = run()
        self.assertEqual(planted.returncode, 1)
        self.assertEqual(planted.stdout, "")
        self.assertEqual(planted.stderr,
                         "pi/.pi/agent/AGENTS.md:1:9: "
                         "U+202E RIGHT-TO-LEFT OVERRIDE\n")
        for argument in ("--fix", str(self.path)):
            with self.subTest(argument=argument):
                rejected = run(argument)
                self.assertEqual(rejected.returncode, 1)
                self.assertEqual(rejected.stdout, "")
                self.assertTrue(rejected.stderr.startswith("Usage: "))
                self.assertNotIn("U+202E", rejected.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(list(self.repo.rglob("__pycache__")))

    def test_repository_instruction_markdown_is_clean(self):
        self.assertEqual(CHECKER.scan(ROOT), [])


if __name__ == "__main__":
    unittest.main()
