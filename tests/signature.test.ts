import crypto from 'node:crypto';
import { verifySignature } from '../src/webhook/signature';

const secret = 'test-secret';
const body = JSON.stringify({ id: 'evt_1', type: 'booking.created' });
const sign = (payload: string, key: string) =>
  'sha256=' + crypto.createHmac('sha256', key).update(payload).digest('hex');

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('accepts the raw body as a Buffer', () => {
    expect(verifySignature(Buffer.from(body), sign(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySignature(body + ' ', sign(body, secret), secret)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifySignature(body, sign(body, 'other-secret'), secret)).toBe(false);
  });

  it('rejects a missing header without throwing', () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });

  it('rejects a malformed or wrong-length header without throwing', () => {
    expect(verifySignature(body, 'sha256=abc', secret)).toBe(false);
    expect(verifySignature(body, 'not-a-signature', secret)).toBe(false);
    expect(verifySignature(body, '', secret)).toBe(false);
  });
});
