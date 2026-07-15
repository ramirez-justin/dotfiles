import base64
import hashlib
import importlib.util
from importlib.machinery import ModuleSpec
from pathlib import Path
import socket
import threading
import time
from typing import cast
import unittest


MODULE_PATH = Path(__file__).parents[1] / "calendar_oauth.py"
spec = cast(
    ModuleSpec,
    importlib.util.spec_from_file_location("calendar_oauth", MODULE_PATH),
)
calendar_oauth = importlib.util.module_from_spec(spec)
loader = spec.loader
assert loader is not None
loader.exec_module(calendar_oauth)


class OAuthSecurityTests(unittest.TestCase):
    def test_state_is_random_and_url_safe(self):
        first = calendar_oauth.generate_state()
        second = calendar_oauth.generate_state()
        self.assertNotEqual(first, second)
        self.assertRegex(first, r"^[A-Za-z0-9_-]+$")

    def test_pkce_challenge_matches_verifier(self):
        verifier, challenge = calendar_oauth.generate_pkce()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        self.assertEqual(challenge, expected)

    def test_valid_callback_returns_code(self):
        code = calendar_oauth.validate_callback(
            "/oauth/callback?code=abc123&state=expected", "expected"
        )
        self.assertEqual(code, "abc123")

    def test_wrong_state_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "state"):
            calendar_oauth.validate_callback(
                "/oauth/callback?code=abc123&state=wrong", "expected"
            )

    def test_wrong_path_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "path"):
            calendar_oauth.validate_callback(
                "/wrong?code=abc123&state=expected", "expected"
            )

    def test_missing_code_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "code"):
            calendar_oauth.validate_callback(
                "/oauth/callback?state=expected", "expected"
            )

    def test_oauth_error_is_rejected_without_description(self):
        with self.assertRaisesRegex(
            ValueError, "authorization failed"
        ) as caught:
            calendar_oauth.validate_callback(
                "/oauth/callback?error=access_denied&"
                "error_description=sensitive&state=expected",
                "expected",
            )
        self.assertNotIn("sensitive", str(caught.exception))

    def test_server_binds_only_to_loopback(self):
        server = calendar_oauth.create_callback_server("expected")
        try:
            self.assertEqual(server.server_address[0], "127.0.0.1")
            self.assertGreater(server.server_address[1], 0)
        finally:
            server.server_close()

    def test_slow_connection_cannot_extend_overall_deadline(self):
        server = calendar_oauth.create_callback_server("expected")
        outcome = []

        def wait_for_callback():
            try:
                calendar_oauth.wait_for_callback(server, 0.2)
            except TimeoutError:
                outcome.append("timed-out")

        waiter = threading.Thread(target=wait_for_callback)
        started = time.monotonic()
        waiter.start()
        with socket.create_connection(server.server_address) as connection:
            drip_deadline = time.monotonic() + 0.6
            while waiter.is_alive() and time.monotonic() < drip_deadline:
                try:
                    connection.sendall(b"G")
                except OSError:
                    break
                time.sleep(0.05)
        waiter.join(timeout=0.5)
        elapsed = time.monotonic() - started
        server.server_close()

        self.assertFalse(waiter.is_alive())
        self.assertLess(elapsed, 0.45)
        self.assertEqual(outcome, ["timed-out"])


if __name__ == "__main__":
    unittest.main()
