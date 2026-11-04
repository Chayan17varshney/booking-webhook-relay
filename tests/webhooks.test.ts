import crypto from 'node:crypto';
import request from 'supertest';
import { createApp, SIGNATURE_HEADER } from '../src/app';

const secret = 'test-secret';
const sign = (body: string, key = secret) =>
  'sha256=' + crypto.createHmac('sha256', key).update(body).digest('hex');

const event = {
  id: 'evt_1',
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
};

const post = (body: string, headers: Record<string, string> = {}, app = createApp({ webhookSecret: secret })) =>
  request(app)
    .post('/webhooks/bookings')
    .set('Content-Type', 'application/json')
    .set(headers)
    .send(body);

describe('POST /webhooks/bookings', () => {
  it('accepts a correctly signed, valid event with 202', async () => {
    const body = JSON.stringify(event);
    const res = await post(body, { [SIGNATURE_HEADER]: sign(body) });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'accepted', eventId: 'evt_1' });
  });

  it('still accepts an event whose phone number is invalid', async () => {
    const body = JSON.stringify({ ...event, customer: { ...event.customer, phone: '12345' } });
    const res = await post(body, { [SIGNATURE_HEADER]: sign(body) });
    expect(res.status).toBe(202);
  });

  it('rejects a missing signature with 401', async () => {
    const res = await post(JSON.stringify(event));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
  });

  it('rejects a signature made with the wrong secret with 401', async () => {
    const body = JSON.stringify(event);
    const res = await post(body, { [SIGNATURE_HEADER]: sign(body, 'other-secret') });
    expect(res.status).toBe(401);
  });

  it('rejects a body that was changed after signing with 401', async () => {
    const body = JSON.stringify(event);
    const tampered = JSON.stringify({ ...event, service: 'Free upgrade' });
    const res = await post(tampered, { [SIGNATURE_HEADER]: sign(body) });
    expect(res.status).toBe(401);
  });

  it('returns 400 for a signed body that is not valid JSON', async () => {
    const body = '{ not json';
    const res = await post(body, { [SIGNATURE_HEADER]: sign(body) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('returns 422 with details for a signed body that fails validation', async () => {
    const body = JSON.stringify({ ...event, customer: { name: 'Asha Rao' } });
    const res = await post(body, { [SIGNATURE_HEADER]: sign(body) });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_payload');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('returns 415 when the content type is not JSON', async () => {
    const res = await request(createApp({ webhookSecret: secret }))
      .post('/webhooks/bookings')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(415);
  });

  it('fails closed with 500 when no secret is configured', async () => {
    const body = JSON.stringify(event);
    const res = await post(body, { [SIGNATURE_HEADER]: sign(body, '') }, createApp({ webhookSecret: '' }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('server_misconfigured');
  });
});
