#!/usr/bin/env python3
"""Small Notion API helper for Pi skills. Uses only the Python standard library."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


def die(msg: str, code: int = 1):
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def token() -> str:
    value = os.environ.get("NOTION_API_KEY") or os.environ.get("NOTION_TOKEN")
    if not value:
        die("Missing NOTION_API_KEY. Add it to ~/.pi/agent/env.local.zsh, preferably via 1Password injection.")
    return value


def request(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        API_BASE + path,
        data=data,
        headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION,
            "User-Agent": "pi-notion-skill",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            if res.status == 204:
                return {"ok": True}
            return json.load(res)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        die(f"Notion API HTTP {e.code}: {detail}")


def print_json(data):
    print(json.dumps(data, indent=2, sort_keys=True))


def load_json_arg(value: str, label: str) -> dict | list:
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        die(f"Invalid JSON for {label}: {e}")


def require_approval(args, operation: str, payload: dict):
    if args.yes:
        return
    print("Mutation requires explicit approval. Review this payload, ask the user for approval, then rerun with --yes.")
    print_json({"operation": operation, "payload": payload})
    raise SystemExit(2)


def cmd_search(args):
    payload = {"query": args.query, "page_size": args.page_size}
    if args.filter:
        payload["filter"] = load_json_arg(args.filter, "--filter")
    print_json(request("POST", "/search", payload))


def cmd_page(args):
    print_json(request("GET", f"/pages/{args.page_id}"))


def cmd_block_children(args):
    print_json(request("GET", f"/blocks/{args.block_id}/children?page_size={args.page_size}"))


def cmd_database_query(args):
    payload = {}
    if args.filter:
        payload["filter"] = load_json_arg(args.filter, "--filter")
    if args.sorts:
        payload["sorts"] = load_json_arg(args.sorts, "--sorts")
    print_json(request("POST", f"/databases/{args.database_id}/query", payload))


def cmd_create_page(args):
    payload = {"parent": load_json_arg(args.parent, "--parent"), "properties": load_json_arg(args.properties, "--properties")}
    if args.children:
        payload["children"] = load_json_arg(args.children, "--children")
    require_approval(args, "pages.create", payload)
    print_json(request("POST", "/pages", payload))


def cmd_update_page(args):
    payload = {}
    if args.properties:
        payload["properties"] = load_json_arg(args.properties, "--properties")
    if args.archived is not None:
        payload["archived"] = args.archived == "true"
    require_approval(args, "pages.update", {"page_id": args.page_id, **payload})
    print_json(request("PATCH", f"/pages/{args.page_id}", payload))


def cmd_append_blocks(args):
    payload = {"children": load_json_arg(args.children, "--children")}
    require_approval(args, "blocks.children.append", {"block_id": args.block_id, **payload})
    print_json(request("PATCH", f"/blocks/{args.block_id}/children", payload))


def cmd_comment(args):
    payload = {"parent": {"page_id": args.page_id}, "rich_text": [{"type": "text", "text": {"content": args.text}}]}
    require_approval(args, "comments.create", payload)
    print_json(request("POST", "/comments", payload))


def main():
    p = argparse.ArgumentParser(description="Notion API helper")
    sub = p.add_subparsers(required=True)

    s = sub.add_parser("search"); s.add_argument("query"); s.add_argument("--page-size", type=int, default=10); s.add_argument("--filter"); s.set_defaults(func=cmd_search)
    s = sub.add_parser("page"); s.add_argument("page_id"); s.set_defaults(func=cmd_page)
    s = sub.add_parser("block-children"); s.add_argument("block_id"); s.add_argument("--page-size", type=int, default=100); s.set_defaults(func=cmd_block_children)
    s = sub.add_parser("database-query"); s.add_argument("database_id"); s.add_argument("--filter"); s.add_argument("--sorts"); s.set_defaults(func=cmd_database_query)

    s = sub.add_parser("create-page")
    s.add_argument("--parent", required=True, help='JSON, e.g. {"database_id":"..."} or {"page_id":"..."}')
    s.add_argument("--properties", required=True, help="Notion properties JSON")
    s.add_argument("--children", help="Optional Notion block children JSON array")
    s.add_argument("--yes", action="store_true"); s.set_defaults(func=cmd_create_page)

    s = sub.add_parser("update-page")
    s.add_argument("page_id"); s.add_argument("--properties", help="Notion properties JSON"); s.add_argument("--archived", choices=["true", "false"])
    s.add_argument("--yes", action="store_true"); s.set_defaults(func=cmd_update_page)

    s = sub.add_parser("append-blocks")
    s.add_argument("block_id"); s.add_argument("--children", required=True, help="Notion block children JSON array")
    s.add_argument("--yes", action="store_true"); s.set_defaults(func=cmd_append_blocks)

    s = sub.add_parser("comment")
    s.add_argument("page_id"); s.add_argument("--text", required=True); s.add_argument("--yes", action="store_true"); s.set_defaults(func=cmd_comment)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
