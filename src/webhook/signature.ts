import crypto from 'node:crypto';

const PREFIX = 'sha256=';
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Verify an HMAC-SHA256 webhook signature.
 *
 * Header format: "sha256=<hex digest of the raw body, keyed with the shared secret>".
 * Returns false (never throws) for a missing, malformed or wrong-length header, or an
 * empty secret, and compares in constant time so response timing does not leak
 * how many leading bytes matched.
 */
export function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader || !signatureHeader.startsWith(PREFIX)) {
    return false;
  }

  const provided = signatureHeader.slice(PREFIX.length);
  if (!HEX_SHA256.test(provided)) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const providedBytes = Buffer.from(provided, 'hex');

  // timingSafeEqual throws if lengths differ; the regex above already guarantees 32 bytes,
  // but check anyway so this function can never throw.
  return providedBytes.length === expected.length && crypto.timingSafeEqual(providedBytes, expected);
}
