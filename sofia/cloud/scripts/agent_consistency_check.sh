#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
project_ref_file="$repo_root/sofia/cloud/supabase/.temp/project-ref"
pi_mcp="$repo_root/pi/.pi/agent/mcp.json"
hermes_config="$repo_root/hermes/.hermes/profiles/sofia-spike/config.yaml"
hermes_boot="$HOME/.hermes/profiles/sofia-spike/scripts/sofia-boot-context"
expected_ref=""
if [[ -f "$project_ref_file" ]]; then
  expected_ref="$(tr -d '[:space:]' < "$project_ref_file")"
fi
expected_url="https://${expected_ref}.supabase.co/functions/v1/sofia-core"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok: %s\n' "$*"; }

[[ -n "$expected_ref" ]] || fail "missing Supabase project ref at $project_ref_file"
pass "Supabase project ref present: $expected_ref"

python3 - "$pi_mcp" "$expected_url" <<'PY'
import json, sys
path, expected_url = sys.argv[1:]
with open(path) as f:
    data = json.load(f)
server = data.get("mcpServers", {}).get("sofia-cloud")
if not server:
    raise SystemExit("Pi mcp.json missing mcpServers.sofia-cloud")
if server.get("url") != expected_url:
    raise SystemExit(f"Pi sofia-cloud URL mismatch: {server.get('url')} != {expected_url}")
header = (server.get("headers") or {}).get("x-sofia-key")
if header != "${SOFIA_MCP_ACCESS_KEY}":
    raise SystemExit("Pi sofia-cloud header must use ${SOFIA_MCP_ACCESS_KEY}")
print("ok: Pi MCP config points at SOFIA Cloud and uses env secret reference")
PY

[[ -f "$hermes_config" ]] || fail "missing Hermes SOFIA profile config"
grep -q 'mcp_servers:' "$hermes_config" || fail "Hermes config missing mcp_servers"
grep -q 'sofia-cloud:' "$hermes_config" || fail "Hermes config missing sofia-cloud MCP server"
grep -q 'url: ${SOFIA_CLOUD_URL}' "$hermes_config" || fail "Hermes sofia-cloud URL must use SOFIA_CLOUD_URL env reference"
grep -q 'x-sofia-key: ${SOFIA_MCP_ACCESS_KEY}' "$hermes_config" || fail "Hermes sofia-cloud header must use SOFIA_MCP_ACCESS_KEY env reference"
grep -q 'memory_enabled: false' "$hermes_config" || fail "Hermes local memory should remain disabled"
grep -q 'get_boot_context' "$hermes_config" || fail "Hermes MCP include list missing get_boot_context"
grep -q 'run_lifecycle_maintenance' "$hermes_config" || fail "Hermes MCP include list missing run_lifecycle_maintenance"
pass "Hermes SOFIA profile is cloud-first and exposes lifecycle tools"

[[ -x "$hermes_boot" ]] || fail "linked Hermes boot-context helper is missing or not executable: $hermes_boot"
pass "Hermes boot-context helper is linked and executable"

if [[ "${SOFIA_AGENT_CONSISTENCY_LIVE:-0}" == "1" ]]; then
  [[ -n "${SOFIA_MCP_ACCESS_KEY:-}" ]] || fail "SOFIA_MCP_ACCESS_KEY missing for live boot-context check"
  output="$($hermes_boot personal)"
  grep -q 'SOFIA Cloud compiled boot context' <<<"$output" || fail "Hermes boot context did not come from SOFIA Cloud"
  grep -q 'Postgres is canonical' <<<"$output" || fail "Hermes boot context missing canonical Postgres marker"
  pass "live Hermes boot-context fetch returned SOFIA Cloud compiled context"
else
  pass "live boot-context check skipped (set SOFIA_AGENT_CONSISTENCY_LIVE=1 to enable)"
fi
