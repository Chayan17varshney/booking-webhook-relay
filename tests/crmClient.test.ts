import { CrmError, HttpCrmClient } from '../src/crm/crmClient';
import type { BookingEvent } from '../src/webhook/schema';

const event: BookingEvent = {
  id: 'evt_1',
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
};

const respond = (status: number) => jest.fn().mockResolvedValue(new Response(null, { status }));
const client = (fetchFn: typeof fetch) =>
  new HttpCrmClient({ baseUrl: 'https://crm.test/', apiKey: 'key-123', fetchFn });

describe('HttpCrmClient', () => {
  it('sends the contact with auth and an idempotency key', async () => {
    const fetchFn = respond(201);
    await client(fetchFn as unknown as typeof fetch).createContact(event);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://crm.test/contacts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer key-123');
    expect(init.headers['Idempotency-Key']).toBe('evt_1');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ email: 'asha@example.com', name: 'Asha Rao', phone: '+919876543210' });
    expect(body.attributes.bookingId).toBe('evt_1');
  });

  it('omits the phone field when there is none', async () => {
    const fetchFn = respond(201);
    const noPhone = { ...event, customer: { name: 'Asha Rao', email: 'asha@example.com' } };
    await client(fetchFn as unknown as typeof fetch).createContact(noPhone);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).not.toHaveProperty('phone');
  });

  it.each([200, 201, 409])('treats HTTP %i as success', async (status) => {
    await expect(client(respond(status) as unknown as typeof fetch).createContact(event)).resolves.toBeUndefined();
  });

  it.each([408, 429, 500, 502, 503])('treats HTTP %i as a retryable failure', async (status) => {
    const err = await client(respond(status) as unknown as typeof fetch).createContact(event).catch((e) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(status);
  });

  it.each([400, 401, 403, 404, 422])('treats HTTP %i as a non-retryable failure', async (status) => {
    const err = await client(respond(status) as unknown as typeof fetch).createContact(event).catch((e) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect(err.retryable).toBe(false);
  });

  it('treats a network error as retryable and keeps customer details out of the message', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED asha@example.com'));
    const err = await client(fetchFn as unknown as typeof fetch).createContact(event).catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain('asha@example.com');
  });

  it('treats a timeout as retryable', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const fetchFn = jest.fn().mockRejectedValue(timeout);
    const err = await client(fetchFn as unknown as typeof fetch).createContact(event).catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('TimeoutError');
  });
});

describe('HttpCrmClient edge cases', () => {
  it('describes a non-Error rejection safely', async () => {
    const fetchFn = jest.fn().mockRejectedValue('boom');
    const err = await client(fetchFn as unknown as typeof fetch).createContact(event).catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('CRM request failed (unknown error)');
  });

  it('uses a default timeout and the global fetch when none are given', () => {
    expect(() => new HttpCrmClient({ baseUrl: 'https://crm.test', apiKey: 'k' })).not.toThrow();
  });
});
