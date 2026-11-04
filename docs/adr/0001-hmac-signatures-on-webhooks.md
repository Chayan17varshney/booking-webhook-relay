# 0001. HMAC signatures on webhooks

Date: 2026-11-04
Status: Accepted

## Context
The relay exposes one public endpoint, `POST /webhooks/bookings`. Anyone who finds the URL can send it a request, and each accepted request ends up as a contact in the CRM. The service needs to know that a request came from the booking system and that nobody changed it on the way.

## Decision
The sender signs the exact request body with HMAC-SHA256 and a shared secret. It sends the result in a header as `sha256=<hex digest>`. The relay recomputes the digest over the raw bytes and compares the two with `crypto.timingSafeEqual`.

Three details matter:
- The route reads the raw body (`express.raw`) and parses JSON only after the signature passes. A parsed and re-serialised body can differ from what was signed.
- `verifySignature` returns false for a missing header, a wrong prefix, a digest that is not 64 hex characters, or an empty secret. It never throws.
- If no secret is configured, the endpoint answers 500. It never falls back to accepting everything.

## Alternatives considered
- **A static API key in a header.** Simple, but the key travels with every request, so anyone who sees one request can replay or forge others. An HMAC proves the sender knew the secret and binds the signature to the body.
- **mTLS.** Strong, but it needs certificate handling on both sides, which is too much for a single webhook.
- **IP allow-listing.** The booking provider's addresses can change, and a spoofed or shared address defeats it.

## Consequences
- Forged and tampered requests are rejected with 401 before any parsing or database work.
- A captured valid request can still be replayed, because the signature has no timestamp. Duplicate delivery is handled by idempotency (see 0003), so a replay creates no second event. A timestamp in the signed string with a tolerance window would close this and would be the next change.
- The secret has to be rotated by hand on both sides. It is stored in SSM Parameter Store in the AWS deploy.
