#!/usr/bin/env python3
"""Small Linear API helper for Pi skills. Uses only the Python standard library."""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import NoReturn

API_URL = "https://api.linear.app/graphql"


def die(msg: str, code: int = 1) -> NoReturn:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def token() -> str:
    value = os.environ.get("LINEAR_API_KEY") or os.environ.get("LINEAR_API_TOKEN")
    if not value:
        die(
            "Missing LINEAR_API_KEY. Add it to ~/.pi/agent/env.local.zsh, preferably via 1Password injection."
        )
    return value


def graphql(query: str, variables: dict | None = None) -> dict:
    body: dict = {}
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Authorization": token(),
            "Content-Type": "application/json",
            "User-Agent": "pi-linear-skill",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.load(res)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        die(f"Linear API HTTP {e.code}: {detail}")
    if body.get("errors"):
        die(json.dumps(body["errors"], indent=2))
    return body["data"]


def print_json(data):
    print(json.dumps(data, indent=2, sort_keys=True))


def require_approval(args, operation: str, payload: dict):
    if args.yes:
        return
    print(
        "Mutation requires explicit approval. Review this payload, ask the user for approval, then rerun with --yes."
    )
    print_json({"operation": operation, "payload": payload})
    raise SystemExit(2)


ISSUE_FIELDS = """
  id identifier title url description
  priority
  state { id name type }
  assignee { id name email }
  team { id key name }
  labels { nodes { id name } }
  createdAt updatedAt
"""


def cmd_viewer(_args):
    print_json(graphql("query { viewer { id name email } }"))


def cmd_teams(args):
    q = "query($first:Int!) { teams(first:$first) { nodes { id key name } } }"
    print_json(graphql(q, {"first": args.first}))


def cmd_assigned(args):
    q = f"query($first:Int!) {{ viewer {{ assignedIssues(first:$first) {{ nodes {{ {ISSUE_FIELDS} }} }} }} }}"
    print_json(graphql(q, {"first": args.first}))


def cmd_search(args):
    q = f"""
    query($term:String!, $first:Int!) {{
      issues(first:$first, filter: {{ or: [{{ title: {{ contains: $term }} }}, {{ description: {{ contains: $term }} }}] }}) {{
        nodes {{ {ISSUE_FIELDS} }}
      }}
    }}
    """
    print_json(graphql(q, {"term": args.term, "first": args.first}))


def cmd_get(args):
    q = f"query($id:String!) {{ issue(id:$id) {{ {ISSUE_FIELDS} comments(first:20) {{ nodes {{ id body user {{ name }} createdAt }} }} }} }}"
    print_json(graphql(q, {"id": args.issue}))


def cmd_create(args):
    payload = {
        k: v
        for k, v in {
            "teamId": args.team_id,
            "title": args.title,
            "description": args.description,
            "priority": args.priority,
            "assigneeId": args.assignee_id,
            "stateId": args.state_id,
        }.items()
        if v is not None
    }
    require_approval(args, "issueCreate", payload)
    q = f"mutation($input:IssueCreateInput!) {{ issueCreate(input:$input) {{ success issue {{ {ISSUE_FIELDS} }} }} }}"
    print_json(graphql(q, {"input": payload}))


def cmd_update(args):
    input_payload = {
        k: v
        for k, v in {
            "title": args.title,
            "description": args.description,
            "priority": args.priority,
            "assigneeId": args.assignee_id,
            "stateId": args.state_id,
        }.items()
        if v is not None
    }
    payload = {"id": args.issue, "input": input_payload}
    require_approval(args, "issueUpdate", payload)
    q = f"mutation($id:String!, $input:IssueUpdateInput!) {{ issueUpdate(id:$id, input:$input) {{ success issue {{ {ISSUE_FIELDS} }} }} }}"
    print_json(graphql(q, payload))


def cmd_comment(args):
    payload = {"issueId": args.issue, "body": args.body}
    require_approval(args, "commentCreate", payload)
    q = "mutation($input:CommentCreateInput!) { commentCreate(input:$input) { success comment { id body url createdAt user { name } } } }"
    print_json(graphql(q, {"input": payload}))


def main():
    p = argparse.ArgumentParser(description="Linear API helper")
    sub = p.add_subparsers(required=True)

    s = sub.add_parser("viewer")
    s.set_defaults(func=cmd_viewer)
    s = sub.add_parser("teams")
    s.add_argument("--first", type=int, default=50)
    s.set_defaults(func=cmd_teams)
    s = sub.add_parser("assigned")
    s.add_argument("--first", type=int, default=25)
    s.set_defaults(func=cmd_assigned)
    s = sub.add_parser("search")
    s.add_argument("term")
    s.add_argument("--first", type=int, default=25)
    s.set_defaults(func=cmd_search)
    s = sub.add_parser("get")
    s.add_argument("issue", help="Issue key like ABC-123 or Linear issue UUID")
    s.set_defaults(func=cmd_get)

    s = sub.add_parser("create")
    s.add_argument("--team-id", required=True)
    s.add_argument("--title", required=True)
    s.add_argument("--description")
    s.add_argument("--priority", type=int)
    s.add_argument("--assignee-id")
    s.add_argument("--state-id")
    s.add_argument("--yes", action="store_true")
    s.set_defaults(func=cmd_create)

    s = sub.add_parser("update")
    s.add_argument("issue")
    s.add_argument("--title")
    s.add_argument("--description")
    s.add_argument("--priority", type=int)
    s.add_argument("--assignee-id")
    s.add_argument("--state-id")
    s.add_argument("--yes", action="store_true")
    s.set_defaults(func=cmd_update)

    s = sub.add_parser("comment")
    s.add_argument("issue")
    s.add_argument("--body", required=True)
    s.add_argument("--yes", action="store_true")
    s.set_defaults(func=cmd_comment)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
