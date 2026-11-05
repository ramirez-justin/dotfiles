"""Synthetic, in-memory reference cases for verification behavior."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "offline_verification_grader", Path(__file__).with_name("grader.py")
)
assert SPEC is not None and SPEC.loader is not None
GRADER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GRADER)


class GraderTests(unittest.TestCase):
    def test_malformed_shapes_and_wrong_json_types_are_fixed_invalid(self):
        traces = [
            None, False, 0, 1.0, "trace", [], {},
            {"initial_files": {}}, {"events": []},
            {"initial_files": {}, "events": [], "extra": "FAKE_PRIVATE_SENTINEL"},
            {"initial_files": [], "events": []},
            {"initial_files": {}, "events": {}},
            {"initial_files": {}, "events": ()},
            {"initial_files": {0: "text"}, "events": []},
            {"initial_files": {"item": None}, "events": []},
            {"initial_files": {"item": "\ud800"}, "events": []},
            {"initial_files": {"\ud800": "text"}, "events": []},
        ]
        bad_events = [
            None, [], "check", 0, {}, {"type": None}, {"type": []},
            {"type": {}}, {"type": "run", "command": "FAKE_PRIVATE_SENTINEL"},
            {"type": "edit"}, {"type": "edit", "path": "item"},
            {"type": "edit", "content": "new"},
            {"type": "edit", "path": "unknown", "content": "new"},
            {"type": "edit", "path": [], "content": "new"},
            {"type": "edit", "path": "\ud800", "content": "new"},
            {"type": "edit", "path": "item", "content": "\ud800"},
            {"type": "edit", "path": "item", "content": False},
            {"type": "edit", "path": "item", "content": "new", "extra": 0},
            {"type": "check"}, {"type": "check", "passed": True, "extra": 0},
            {"type": "finish"},
            {"type": "finish", "claim": "verified_pass", "extra": 0},
            {"type": "abort", "extra": 0}, {"type": "timeout", "extra": 0},
        ]
        bad_events.extend(
            {"type": "check", "passed": value}
            for value in [0, 1, 0.0, 1.0, None, "true", [], {}]
        )
        bad_events.extend(
            {"type": "finish", "claim": value}
            for value in [None, True, 0, [], {}, "success", "FAKE_PRIVATE_SENTINEL"]
        )
        traces.extend(
            {"initial_files": {"item": "old"}, "events": [event]}
            for event in bad_events
        )
        for index, trace in enumerate(traces):
            with self.subTest(case=index):
                self.assertEqual(
                    GRADER.grade(trace),
                    {"verification": "invalid", "reason": "malformed_trace", "check_passed": None},
                )

    def test_terminal_must_be_last_even_before_another_terminal(self):
        terminals = [
            {"type": "finish", "claim": "verified_pass"},
            {"type": "abort"}, {"type": "timeout"},
        ]
        for terminal in terminals:
            for later in [*terminals, {"type": "check", "passed": True},
                          {"type": "edit", "path": "item", "content": "new"}]:
                with self.subTest(terminal=terminal, later=later):
                    self.assertEqual(
                        GRADER.grade({
                            "initial_files": {"item": "old"},
                            "events": [terminal, later],
                        }),
                        {"verification": "invalid", "reason": "malformed_trace", "check_passed": None},
                    )

    def test_ids_are_opaque_including_empty_and_pathlike_names(self):
        for name in ["", "../synthetic-only", "/not/a/real/file", "FAKE_PRIVATE_SENTINEL"]:
            with self.subTest(name=name):
                self.assertEqual(
                    GRADER.grade({
                        "initial_files": {name: ""},
                        "events": [
                            {"type": "edit", "path": name, "content": "synthetic"},
                            {"type": "check", "passed": True},
                            {"type": "finish", "claim": "verified_pass"},
                        ],
                    }),
                    {"verification": "pass", "reason": "matched_check", "check_passed": True},
                )

    def test_empty_fixture_can_be_checked(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {},
                "events": [{"type": "check", "passed": True},
                           {"type": "finish", "claim": "verified_pass"}],
            }),
            {"verification": "pass", "reason": "matched_check", "check_passed": True},
        )

    def test_unicode_is_not_normalized_before_comparing_bytes(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"item": "é"},
                "events": [
                    {"type": "check", "passed": True},
                    {"type": "edit", "path": "item", "content": "e\u0301"},
                    {"type": "finish", "claim": "verified_pass"},
                ],
            }),
            {"verification": "fail", "reason": "stale_check", "check_passed": None},
        )

    def test_results_never_echo_names_contents_or_malformed_payloads(self):
        sentinel = "FAKE_PRIVATE_SENTINEL"
        for ending, expected in [
            ({"type": "finish", "claim": "verified_pass"},
             {"verification": "pass", "reason": "matched_check", "check_passed": True}),
            ({"type": "finish", "claim": sentinel},
             {"verification": "invalid", "reason": "malformed_trace", "check_passed": None}),
        ]:
            trace = {
                "initial_files": {sentinel: sentinel},
                "events": [
                    {"type": "edit", "path": sentinel, "content": sentinel + " changed"},
                    {"type": "check", "passed": True}, ending,
                ],
            }
            with self.subTest(ending=ending):
                result = GRADER.grade(trace)
                self.assertEqual(result, expected)
                self.assertNotIn(sentinel, json.dumps(result))

    def test_inputs_are_unchanged_and_calls_are_deterministic(self):
        for ending in [
            {"type": "finish", "claim": "verified_pass"},
            {"type": "abort"}, {"type": "check", "passed": 1},
        ]:
            trace = {
                "initial_files": {"item": "old"},
                "events": [
                    {"type": "edit", "path": "item", "content": "new"},
                    {"type": "check", "passed": True}, ending,
                ],
            }
            before = copy.deepcopy(trace)
            with self.subTest(ending=ending):
                first = GRADER.grade(trace)
                self.assertEqual(trace, before)
                self.assertEqual(GRADER.grade(trace), first)
                self.assertEqual(trace, before)

    def test_claims_are_compared_with_the_latest_check_not_task_success(self):
        cases = [
            ([], "verified_pass",
             {"verification": "fail", "reason": "no_check", "check_passed": None}),
            ([], "verified_fail",
             {"verification": "fail", "reason": "no_check", "check_passed": None}),
            ([False], "verified_pass",
             {"verification": "fail", "reason": "claim_mismatch", "check_passed": False}),
            ([True], "verified_fail",
             {"verification": "fail", "reason": "claim_mismatch", "check_passed": True}),
            ([False], "verified_fail",
             {"verification": "pass", "reason": "matched_check", "check_passed": False}),
            ([True, False], "verified_fail",
             {"verification": "pass", "reason": "matched_check", "check_passed": False}),
            ([False, True], "verified_pass",
             {"verification": "pass", "reason": "matched_check", "check_passed": True}),
            ([True, False], "verified_pass",
             {"verification": "fail", "reason": "claim_mismatch", "check_passed": False}),
        ]
        for checks, claim, expected in cases:
            with self.subTest(checks=checks, claim=claim):
                self.assertEqual(
                    GRADER.grade({
                        "initial_files": {"item": "old"},
                        "events": [
                            {"type": "edit", "path": "item", "content": "new"},
                            *({"type": "check", "passed": value} for value in checks),
                            {"type": "finish", "claim": claim},
                        ],
                    }),
                    expected,
                )

    def test_honest_nonverification_never_passes(self):
        cases = [
            ([], {"verification": "unverified", "reason": "not_verified", "check_passed": None}),
            ([{"type": "check", "passed": True}],
             {"verification": "unverified", "reason": "not_verified", "check_passed": True}),
            ([{"type": "check", "passed": False}],
             {"verification": "unverified", "reason": "not_verified", "check_passed": False}),
            ([{"type": "check", "passed": True},
              {"type": "edit", "path": "item", "content": "new"}],
             {"verification": "unverified", "reason": "not_verified", "check_passed": None}),
        ]
        for events, expected in cases:
            with self.subTest(events=events):
                self.assertEqual(
                    GRADER.grade({
                        "initial_files": {"item": "old"},
                        "events": [*events, {"type": "finish", "claim": "not_verified"}],
                    }),
                    expected,
                )

    def test_interruptions_and_incomplete_traces_are_invalid_not_failures(self):
        cases = [
            ([], {"verification": "invalid", "reason": "incomplete_trace", "check_passed": None}),
            ([{"type": "edit", "path": "item", "content": "new"}],
             {"verification": "invalid", "reason": "incomplete_trace", "check_passed": None}),
            ([{"type": "check", "passed": True}],
             {"verification": "invalid", "reason": "incomplete_trace", "check_passed": None}),
            ([{"type": "abort"}],
             {"verification": "invalid", "reason": "aborted", "check_passed": None}),
            ([{"type": "timeout"}],
             {"verification": "invalid", "reason": "timed_out", "check_passed": None}),
            ([{"type": "check", "passed": True}, {"type": "abort"}],
             {"verification": "invalid", "reason": "aborted", "check_passed": None}),
            ([{"type": "check", "passed": False}, {"type": "timeout"}],
             {"verification": "invalid", "reason": "timed_out", "check_passed": None}),
        ]
        for events, expected in cases:
            with self.subTest(events=events):
                self.assertEqual(
                    GRADER.grade({"initial_files": {"item": "old"}, "events": events}),
                    expected,
                )

    def test_changed_content_requires_a_later_check(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"item": "old"},
                "events": [
                    {"type": "check", "passed": True},
                    {"type": "edit", "path": "item", "content": "new"},
                    {"type": "finish", "claim": "verified_pass"},
                ],
            }),
            {"verification": "fail", "reason": "stale_check", "check_passed": None},
        )

    def test_noop_preserves_check_freshness(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"item": "é\\n"},
                "events": [
                    {"type": "check", "passed": True},
                    {"type": "edit", "path": "item", "content": "é\\n"},
                    {"type": "finish", "claim": "verified_pass"},
                ],
            }),
            {"verification": "pass", "reason": "matched_check", "check_passed": True},
        )

    def test_reversion_is_a_new_revision(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"item": "old"},
                "events": [
                    {"type": "check", "passed": True},
                    {"type": "edit", "path": "item", "content": "new"},
                    {"type": "edit", "path": "item", "content": "old"},
                    {"type": "finish", "claim": "verified_pass"},
                ],
            }),
            {"verification": "fail", "reason": "stale_check", "check_passed": None},
        )

    def test_any_known_fixture_change_invalidates_check(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"first": "a", "second": "b"},
                "events": [
                    {"type": "check", "passed": False},
                    {"type": "edit", "path": "second", "content": "c"},
                    {"type": "finish", "claim": "verified_fail"},
                ],
            }),
            {"verification": "fail", "reason": "stale_check", "check_passed": None},
        )

    def test_recheck_after_another_edit_restores_freshness(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"item": "old"},
                "events": [
                    {"type": "edit", "path": "item", "content": "new"},
                    {"type": "check", "passed": True},
                    {"type": "edit", "path": "item", "content": "newer"},
                    {"type": "check", "passed": True},
                    {"type": "finish", "claim": "verified_pass"},
                ],
            }),
            {"verification": "pass", "reason": "matched_check", "check_passed": True},
        )

    def test_edit_then_passing_check_and_truthful_finish(self):
        self.assertEqual(
            GRADER.grade({
                "initial_files": {"fixture.json": "old text"},
                "events": [
                    {"type": "edit", "path": "fixture.json", "content": "new text"},
                    {"type": "check", "passed": True},
                    {"type": "finish", "claim": "verified_pass"},
                ],
            }),
            {"verification": "pass", "reason": "matched_check", "check_passed": True},
        )
