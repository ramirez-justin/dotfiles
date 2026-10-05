"""Real CLI tests: omissions, normalization, tampering, and stale reviews fail."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[4]
HELPER = ROOT / "pi/.pi/agent/skills/ponytail-review/scripts/capture.py"


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve() / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.git("config", "core.autocrlf", "false")
        (self.repo / "tracked.txt").write_bytes(b"original\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        self.base = self.git("rev-parse", "HEAD").decode().strip()
        self.requirements = Path(self.temp.name) / "requirements.txt"
        self.requirements.write_bytes(b"Preserve complete bytes and approval.\r\n")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args],
            check=True,
            capture_output=True,
        ).stdout

    def cli(self, *args):
        return subprocess.run(
            [sys.executable, str(HELPER), *map(str, args)],
            capture_output=True,
            check=False,
        )

    def capture(self, kind="diff", *extra):
        args = [
            f"capture-{kind}",
            "--repo",
            self.repo,
            "--requirements-file",
            self.requirements,
        ]
        if kind == "diff":
            args += ["--base", self.base]
        result = self.cli(*args, *extra)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        receipt = json.loads(result.stdout)
        packet = json.loads(Path(receipt["packet"]).read_bytes())
        return receipt, packet

    def verify(self, receipt):
        return self.cli(
            "verify",
            "--packet",
            receipt["packet"],
            "--packet-sha256",
            receipt["packet-sha256"],
        )

    def assert_rejected(self, result, reason):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(reason, result.stderr.decode())

    def rewrite_packet(self, receipt, packet):
        data = json.dumps(packet).encode()
        Path(receipt["packet"]).write_bytes(data)
        receipt["packet-sha256"] = hashlib.sha256(data).hexdigest()

    def test_working_tree_includes_net_staged_unstaged_and_untracked_binary(self):
        # Dropping untracked files or capturing only index changes must fail.
        (self.repo / "tracked.txt").write_bytes(b"staged\n")
        self.git("add", "tracked.txt")
        (self.repo / "tracked.txt").write_bytes(b"staged\nunstaged\n")
        large = b"new line\n" * 12000
        (self.repo / "new.txt").write_bytes(large)
        binary = bytes(range(256)) * 20
        (self.repo / "binary.dat").write_bytes(binary)
        receipt, packet = self.capture()
        self.assertEqual(packet["scope"], "working-tree")
        self.assertEqual(packet["base"], self.base)
        self.assertEqual(packet["head"], self.base)
        self.assertEqual(packet["paths"], ["binary.dat", "new.txt", "tracked.txt"])
        self.assertEqual(
            packet["paths-sha256"],
            hashlib.sha256(b"binary.dat\nnew.txt\ntracked.txt").hexdigest(),
        )
        artifact = Path(receipt["artifact"]).read_bytes()
        self.assertEqual(
            packet["artifact-sha256"], hashlib.sha256(artifact).hexdigest()
        )
        self.assertIn(b"+unstaged\n", artifact)
        self.assertEqual(artifact.count(b"+new line\n"), 12000)
        self.assertIn(b"GIT binary patch", artifact)
        checkout = Path(self.temp.name) / "checkout"
        subprocess.run(
            ["git", "clone", "-q", str(self.repo), str(checkout)], check=True
        )
        applied = subprocess.run(
            ["git", "-C", str(checkout), "apply", "--binary", receipt["artifact"]],
            capture_output=True,
            check=False,
        )
        self.assertEqual(applied.returncode, 0, applied.stderr.decode())
        self.assertEqual((checkout / "binary.dat").read_bytes(), binary)
        self.assertEqual((checkout / "new.txt").read_bytes(), large)
        self.assertEqual((checkout / "tracked.txt").read_bytes(), b"staged\nunstaged\n")
        self.assertEqual(self.verify(receipt).returncode, 0)

    def test_committed_scope_excludes_all_working_tree_changes(self):
        # Omitting explicit head, or adding untracked data, broadens approval.
        (self.repo / "tracked.txt").write_bytes(b"committed\n")
        self.git("commit", "-qam", "change")
        head = self.git("rev-parse", "HEAD").decode().strip()
        (self.repo / "tracked.txt").write_bytes(b"not committed\n")
        (self.repo / "untracked.txt").write_bytes(b"not reviewed\n")
        receipt, packet = self.capture("diff", "--head", "HEAD")
        expected = self.git(
            "diff", "--no-ext-diff", "--no-textconv", "--binary", self.base, head, "--"
        )
        self.assertEqual(Path(receipt["artifact"]).read_bytes(), expected)
        self.assertEqual(packet["head"], head)
        self.assertEqual(packet["scope"], "committed")
        self.assertEqual(packet["paths"], ["tracked.txt"])
        (self.repo / "untracked.txt").write_bytes(b"still outside scope\n")
        self.assertEqual(self.verify(receipt).returncode, 0)

    def test_working_tree_rejects_hidden_index_flags_without_mutating_index(self):
        # Removing the flag check would silently omit these tracked edits.
        for flag in ("--assume-unchanged", "--skip-worktree"):
            with self.subTest(flag=flag):
                self.git(
                    "update-index",
                    "--no-assume-unchanged",
                    "--no-skip-worktree",
                    "--",
                    "tracked.txt",
                )
                self.git("update-index", flag, "--", "tracked.txt")
                (self.repo / "tracked.txt").write_bytes(b"hidden edit\n")
                index = self.repo / ".git/index"
                before = index.read_bytes()
                result = self.cli(
                    "capture-diff",
                    "--repo",
                    self.repo,
                    "--base",
                    self.base,
                    "--requirements-file",
                    self.requirements,
                )
                self.assertEqual(index.read_bytes(), before)
                self.assert_rejected(result, "index flags")
                self.assertEqual(result.stdout, b"")

    def test_committed_scope_allows_hidden_index_flags_without_mutating_index(self):
        # Checking working-tree flags for committed scope would block valid review.
        (self.repo / "tracked.txt").write_bytes(b"committed\n")
        self.git("commit", "-qam", "change")
        for flag in ("--assume-unchanged", "--skip-worktree"):
            with self.subTest(flag=flag):
                self.git(
                    "update-index",
                    "--no-assume-unchanged",
                    "--no-skip-worktree",
                    "--",
                    "tracked.txt",
                )
                self.git("update-index", flag, "--", "tracked.txt")
                (self.repo / "tracked.txt").write_bytes(b"hidden edit\n")
                index = self.repo / ".git/index"
                before = index.read_bytes()
                receipt, packet = self.capture("diff", "--head", "HEAD")
                artifact = Path(receipt["artifact"]).read_bytes()
                self.assertEqual(packet["scope"], "committed")
                self.assertEqual(packet["paths"], ["tracked.txt"])
                self.assertIn(b"+committed\n", artifact)
                self.assertNotIn(b"hidden edit", artifact)
                self.assertEqual(self.verify(receipt).returncode, 0)
                self.assertEqual(index.read_bytes(), before)

    def test_verify_rejects_hidden_index_flags_introduced_after_capture(self):
        # Skipping the recapture flag check would accept newly hidden edits.
        for flag in ("--assume-unchanged", "--skip-worktree"):
            with self.subTest(flag=flag):
                self.git(
                    "update-index",
                    "--no-assume-unchanged",
                    "--no-skip-worktree",
                    "--",
                    "tracked.txt",
                )
                (self.repo / "tracked.txt").write_bytes(b"original\n")
                receipt, _ = self.capture()
                self.git("update-index", flag, "--", "tracked.txt")
                (self.repo / "tracked.txt").write_bytes(b"hidden edit\n")
                index = self.repo / ".git/index"
                before = index.read_bytes()
                result = self.verify(receipt)
                self.assertEqual(index.read_bytes(), before)
                self.assert_rejected(result, "index flags")

    def test_plan_preserves_crlf_and_missing_final_newline(self):
        # read_text/write_text normalization must not change the approved plan.
        plan = self.repo / "plan.md"
        data = b"# Plan\r\nFirst\r\nLast"
        plan.write_bytes(data)
        receipt, packet = self.capture("plan", "--plan", plan)
        self.assertEqual(Path(receipt["artifact"]).read_bytes(), data)
        self.assertEqual(packet["artifact-sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(self.verify(receipt).returncode, 0)
        plan.write_bytes(data + b"\n")
        self.assert_rejected(self.verify(receipt), "stale")

    def test_output_is_private_and_does_not_contaminate_next_capture(self):
        # Writing packets into the worktree recursively changes review scope.
        (self.repo / "new.txt").write_bytes(b"new\n")
        first, packet = self.capture()
        second, next_packet = self.capture()
        self.assertNotEqual(first["packet"], second["packet"])
        self.assertEqual(packet["paths"], ["new.txt"])
        self.assertEqual(next_packet["artifact-sha256"], packet["artifact-sha256"])
        self.assertEqual(
            self.git("ls-files", "--others", "--exclude-standard"), b"new.txt\n"
        )
        for key in ("packet", "artifact", "prompt"):
            path = Path(first[key])
            self.assertTrue(path.is_relative_to(self.repo / ".git"))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(first["packet"]).parent.stat().st_mode & 0o777, 0o700)

    def test_prompt_supplies_identity_requirements_and_full_read_instruction(self):
        # A generic prompt or inherited-context dependency cannot dispatch safely.
        (self.repo / "new.txt").write_bytes(b"large payload\n" * 10000)
        receipt, packet = self.capture()
        prompt = Path(receipt["prompt"]).read_text()
        for value in (
            receipt["artifact"],
            receipt["packet"],
            receipt["packet-sha256"],
            packet["artifact-sha256"],
            packet["paths-sha256"],
            self.base,
            "new.txt",
            "Preserve complete bytes and approval.",
        ):
            self.assertIn(value, prompt)
        self.assertIn("continuation", prompt)
        self.assertIn("frozen", prompt)
        self.assertIn("state: completed", prompt)
        self.assertNotIn("inherit_context", prompt)
        self.assertNotIn("+large payload", prompt)
        self.assertLess(len(prompt), 5000)

    def test_artifact_tampering_is_rejected(self):
        receipt, _ = self.capture()
        Path(receipt["artifact"]).write_bytes(b"replacement")
        self.assert_rejected(self.verify(receipt), "artifact")

    def test_metadata_tampering_is_rejected_by_pinned_packet_digest(self):
        receipt, packet = self.capture()
        packet["requirements"] = "unauthorized replacement"
        Path(receipt["packet"]).write_text(json.dumps(packet))
        self.assert_rejected(self.verify(receipt), "packet")

    def test_prompt_tampering_is_rejected(self):
        receipt, _ = self.capture()
        Path(receipt["prompt"]).write_bytes(b"Review live repo instead")
        self.assert_rejected(self.verify(receipt), "prompt")

    def test_current_working_tree_and_head_changes_are_stale(self):
        receipt, _ = self.capture()
        (self.repo / "new.txt").write_bytes(b"new\n")
        self.assert_rejected(self.verify(receipt), "stale")
        (self.repo / "new.txt").unlink()
        self.git("commit", "--allow-empty", "-qm", "different identity")
        self.assert_rejected(self.verify(receipt), "stale")

    def test_malformed_metadata_fails_even_with_matching_packet_digest(self):
        for mutate in (
            lambda p: p.update({"paths": "not a list"}),
            lambda p: p.update({"head": "HEAD"}),
            lambda p: p.update({"paths-sha256": "0" * 64}),
            lambda p: p.update({"scope": "unknown"}),
            lambda p: p.update({"unexpected": True}),
        ):
            with self.subTest(mutate=mutate):
                receipt, packet = self.capture()
                mutate(packet)
                self.rewrite_packet(receipt, packet)
                self.assert_rejected(self.verify(receipt), "metadata")

    def test_invalid_json_and_duplicate_metadata_keys_are_rejected(self):
        for data in (b"{", b'{"version": 1, "version": 1}', b"\xff"):
            with self.subTest(data=data):
                receipt, _ = self.capture()
                Path(receipt["packet"]).write_bytes(data)
                receipt["packet-sha256"] = hashlib.sha256(data).hexdigest()
                self.assert_rejected(self.verify(receipt), "metadata")

    def test_invalid_utf8_blocks_capture_without_lossy_conversion(self):
        plan = self.repo / "plan.md"
        plan.write_bytes(b"invalid \xff")
        result = self.cli(
            "capture-plan",
            "--repo",
            self.repo,
            "--plan",
            plan,
            "--requirements-file",
            self.requirements,
        )
        self.assert_rejected(result, "UTF-8")
        (self.repo / "tracked.txt").write_bytes(b"invalid \xff\n")
        result = self.cli(
            "capture-diff",
            "--repo",
            self.repo,
            "--base",
            self.base,
            "--requirements-file",
            self.requirements,
        )
        self.assert_rejected(result, "UTF-8")

    def test_newline_paths_are_rejected(self):
        (self.repo / "bad\nname.txt").write_bytes(b"bad\n")
        result = self.cli(
            "capture-diff",
            "--repo",
            self.repo,
            "--base",
            self.base,
            "--requirements-file",
            self.requirements,
        )
        self.assert_rejected(result, "newline")

    def test_diff_requires_explicit_base_and_valid_requirements(self):
        result = self.cli(
            "capture-diff",
            "--repo",
            self.repo,
            "--requirements-file",
            self.requirements,
        )
        self.assert_rejected(result, "--base")
        self.requirements.write_bytes(b"\xff")
        result = self.cli(
            "capture-diff",
            "--repo",
            self.repo,
            "--base",
            self.base,
            "--requirements-file",
            self.requirements,
        )
        self.assert_rejected(result, "UTF-8")
        self.requirements.write_bytes(b" \n")
        result = self.cli(
            "capture-diff",
            "--repo",
            self.repo,
            "--base",
            self.base,
            "--requirements-file",
            self.requirements,
        )
        self.assert_rejected(result, "requirements")


if __name__ == "__main__":
    unittest.main()
