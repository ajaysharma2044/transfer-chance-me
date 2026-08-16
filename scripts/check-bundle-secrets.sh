#!/usr/bin/env bash
# Fail loudly if a server-only secret was compiled into the public bundle.
#
# Vite only inlines env vars prefixed with VITE_, so the usual way a secret leaks
# is somebody renaming ANTHROPIC_API_KEY to VITE_ANTHROPIC_API_KEY to "make it
# work". This catches that before it ships. Run it after every build:
#     npm run build && ./scripts/check-bundle-secrets.sh
set -euo pipefail

DIST="${1:-dist}"
[ -d "$DIST" ] || { echo "check-bundle-secrets: '$DIST' not found - run the build first." >&2; exit 1; }

fail=0
check() {
  local pattern="$1" label="$2"
  if grep -rIlE "$pattern" "$DIST" >/dev/null 2>&1; then
    echo "LEAK: $label found in the build output:" >&2
    grep -rIlE "$pattern" "$DIST" >&2
    fail=1
  fi
}

check 'sk-ant-[A-Za-z0-9_-]{8}'  'an Anthropic API key'
check 'SUPABASE_SERVICE_ROLE_KEY' 'the SUPABASE_SERVICE_ROLE_KEY variable name'
check 'UPSTASH_REDIS_REST_TOKEN'  'the UPSTASH_REDIS_REST_TOKEN variable name'
# Can false-positive on a source comment that merely mentions the role name.
# If it fires, confirm it is a comment and not a real key before dismissing it.
check 'service_role'              'the string "service_role"'

if [ "$fail" -ne 0 ]; then
  cat >&2 <<'MSG'

A server-only secret reached the browser bundle. Do NOT deploy this build.
Server secrets must never be VITE_-prefixed. Read them inside functions/ from
the Env binding instead - see functions/api/_shared.ts.
MSG
  exit 1
fi

echo "check-bundle-secrets: clean ($DIST)"
