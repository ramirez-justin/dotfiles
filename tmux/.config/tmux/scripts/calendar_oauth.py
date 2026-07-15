#!/usr/bin/env python3

import argparse
import base64
import hashlib
import http.server
import json
import secrets
import socket
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser
from typing import cast


AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
CALLBACK_PATH = "/oauth/callback"


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def generate_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest)
    return verifier, challenge.rstrip(b"=").decode("ascii")


def validate_callback(target: str, expected_state: str) -> str:
    parsed = urllib.parse.urlparse(target)
    if parsed.path != CALLBACK_PATH:
        raise ValueError("unexpected callback path")

    query = urllib.parse.parse_qs(parsed.query)
    states = query.get("state", [])
    if len(states) != 1 or not secrets.compare_digest(
        states[0], expected_state
    ):
        raise ValueError("invalid OAuth state")
    if query.get("error"):
        raise ValueError("authorization failed")

    codes = query.get("code", [])
    if len(codes) != 1 or not codes[0]:
        raise ValueError("authorization code missing")
    return codes[0]


class OAuthCallbackServer(
    socketserver.ThreadingMixIn, http.server.HTTPServer
):
    daemon_threads = True
    block_on_close = False
    expected_state: str
    authorization_code: str | None
    callback_error: str | None
    request_timeout: float
    active_requests: set[socket.socket]
    request_lock: threading.Lock

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(self.request_timeout)
        return request, address

    def process_request(self, request, client_address) -> None:
        request_socket = cast(socket.socket, request)
        with self.request_lock:
            self.active_requests.add(request_socket)
        super().process_request(request, client_address)

    def close_request(self, request) -> None:
        request_socket = cast(socket.socket, request)
        with self.request_lock:
            self.active_requests.discard(request_socket)
        super().close_request(request)

    def close_active_requests(self) -> None:
        with self.request_lock:
            requests = list(self.active_requests)
        for request in requests:
            try:
                request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            request.close()

    def handle_error(self, request, client_address) -> None:
        return


class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        server = cast(OAuthCallbackServer, self.server)
        try:
            code = validate_callback(self.path, server.expected_state)
        except ValueError as error:
            server.callback_error = str(error)
            self._respond(400, "Authorization failed. Return to the terminal.")
            return

        server.authorization_code = code
        self._respond(200, "Authorization complete. You may close this tab.")

    def _respond(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def create_callback_server(expected_state: str) -> OAuthCallbackServer:
    server = OAuthCallbackServer(
        ("127.0.0.1", 0), OAuthCallbackHandler
    )
    server.expected_state = expected_state
    server.authorization_code = None
    server.callback_error = None
    server.request_timeout = 1.0
    server.active_requests = set()
    server.request_lock = threading.Lock()
    return server


def wait_for_callback(
    server: OAuthCallbackServer, timeout: float
) -> str:
    deadline = time.monotonic() + timeout
    server.request_timeout = min(1.0, max(0.05, timeout))

    while not server.authorization_code and not server.callback_error:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            server.close_active_requests()
            raise TimeoutError("authorization callback timed out")
        server.timeout = min(remaining, 0.1)
        server.handle_request()

    if server.callback_error:
        raise RuntimeError(server.callback_error)
    if not server.authorization_code:
        raise TimeoutError("authorization callback timed out")
    return server.authorization_code


def build_authorization_url(
    client_id: str,
    scope: str,
    redirect_uri: str,
    state: str,
    challenge: str,
) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scope,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{AUTHORIZATION_ENDPOINT}?{query}"


def authorize(client_id: str, scope: str, timeout: int) -> dict[str, str]:
    state = generate_state()
    verifier, challenge = generate_pkce()
    server = create_callback_server(state)
    redirect_uri = (
        f"http://127.0.0.1:{server.server_address[1]}{CALLBACK_PATH}"
    )
    authorization_url = build_authorization_url(
        client_id, scope, redirect_uri, state, challenge
    )

    try:
        if not webbrowser.open(authorization_url):
            print(
                f"Open this URL to authorize the calendar: "
                f"{authorization_url}",
                file=sys.stderr,
            )
        authorization_code = wait_for_callback(server, timeout)
    finally:
        server.close_active_requests()
        server.server_close()

    return {
        "code": authorization_code,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = authorize(args.client_id, args.scope, args.timeout)
    except (OSError, RuntimeError, TimeoutError) as error:
        print(f"Calendar authorization failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
