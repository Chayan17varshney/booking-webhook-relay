#!/usr/bin/env bash
# End-to-end smoke test against a running stack (docker compose up).
# Defaults match docker-compose.yml's development defaults.
#
#   docker compose up -d --build && npm run smoke
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SECRET="${WEBHOOK_SECRET:-dev-only-secret-change-me}"
ADMIN_KEY="${ADMIN_API_KEY:-dev-only-admin-key-change-me}"
ID="smoke_$(date +%s)_$RANDOM"
RESP="$(mktemp)"
trap 'rm -f "$RESP"' EXIT

fail() { echo "SMOKE FAILED: $*" >&2; echo "last response: $(cat "$RESP" 2>/dev/null)" >&2; exit 1; }

sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //'; }

post_webhook() { # body, signature-header-value -> prints HTTP status
  curl -s -o "$RESP" -w '%{http_code}' -X POST "$BASE_URL/webhooks/bookings" \
    -H 'Content-Type: application/json' -H "X-Webhook-Signature: $2" --data-binary "$1"
}

echo "1. waiting for $BASE_URL/health"
for _ in $(seq 1 60); do
  if curl -fs "$BASE_URL/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fs "$BASE_URL/health" >/dev/null || fail "service never became healthy"

BODY="{\"id\":\"$ID\",\"type\":\"booking.created\",\"customer\":{\"name\":\"Smoke Test\",\"email\":\"smoke@example.com\",\"phone\":\"+91 98765 43210\"},\"service\":\"Smoke test\",\"startsAt\":\"2030-01-01T10:00:00Z\"}"
SIG="sha256=$(sign "$BODY")"

echo "2. signed webhook is accepted"
[ "$(post_webhook "$BODY" "$SIG")" = "202" ] || fail "expected 202 for a valid webhook"
grep -q '"duplicate":false' "$RESP" || fail "first delivery should not be a duplicate"

echo "3. repeating the same webhook is a duplicate"
[ "$(post_webhook "$BODY" "$SIG")" = "202" ] || fail "expected 202 for the repeat"
grep -q '"duplicate":true' "$RESP" || fail "second delivery should be flagged duplicate"

echo "4. a wrong signature is rejected"
[ "$(post_webhook "$BODY" "sha256=$(printf '0%.0s' $(seq 1 64))")" = "401" ] || fail "expected 401 for a bad signature"

echo "5. the read API requires the key"
CODE="$(curl -s -o "$RESP" -w '%{http_code}' "$BASE_URL/events/$ID")"
[ "$CODE" = "401" ] || fail "expected 401 without the API key, got $CODE"

echo "6. the event is forwarded to the CRM (waiting up to 60 s)"
STATUS=""
for _ in $(seq 1 30); do
  curl -s -o "$RESP" -H "X-API-Key: $ADMIN_KEY" "$BASE_URL/events/$ID" || true
  if grep -q '"status":"forwarded"' "$RESP"; then STATUS="forwarded"; break; fi
  sleep 2
done
[ "$STATUS" = "forwarded" ] || fail "event $ID never reached 'forwarded'"

echo "7. the dashboard is served with a strict Content-Security-Policy"
HEADERS="$(curl -s -D - -o "$RESP" "$BASE_URL/dashboard/")"
grep -q '<div id="root">' "$RESP" || fail "the dashboard page was not served at /dashboard/"
echo "$HEADERS" | grep -qi "content-security-policy: default-src 'self'" || fail "the dashboard is missing its Content-Security-Policy header"

echo "SMOKE PASSED: event $ID was accepted, de-duplicated, stored and forwarded, and the dashboard is served"
