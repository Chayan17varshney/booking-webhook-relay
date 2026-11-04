import request from 'supertest';
import { createMockCrm } from '../src/mockCrm/app';

const contact = { email: 'asha@example.com', name: 'Asha Rao' };
const auth = { Authorization: 'Bearer k' };

describe('mock CRM', () => {
  const build = (failRate = 0, random = () => 1) => createMockCrm({ apiKey: 'k', failRate, random });

  it('requires the bearer key', async () => {
    expect((await request(build()).post('/contacts').send(contact)).status).toBe(401);
    expect((await request(build()).post('/contacts').set('Authorization', 'Bearer nope').send(contact)).status).toBe(401);
  });

  it('rejects an invalid contact with 400', async () => {
    const res = await request(build()).post('/contacts').set(auth).send({ name: 'No email' });
    expect(res.status).toBe(400);
    const noBody = await request(build()).post('/contacts').set(auth);
    expect(noBody.status).toBe(400);
  });

  it('creates a contact, then ignores a repeat with the same idempotency key', async () => {
    const app = build();
    const first = await request(app).post('/contacts').set(auth).set('Idempotency-Key', 'evt_1').send(contact);
    const second = await request(app).post('/contacts').set(auth).set('Idempotency-Key', 'evt_1').send(contact);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate_ignored');
    expect((await request(app).get('/contacts/count')).body).toEqual({ count: 1 });
  });

  it('treats different idempotency keys as different contacts', async () => {
    const app = build();
    await request(app).post('/contacts').set(auth).set('Idempotency-Key', 'a').send(contact);
    await request(app).post('/contacts').set(auth).set('Idempotency-Key', 'b').send(contact);
    expect((await request(app).get('/contacts/count')).body).toEqual({ count: 2 });
  });

  it('falls back to the email as the key when no idempotency key is sent', async () => {
    const app = build();
    await request(app).post('/contacts').set(auth).send(contact);
    const again = await request(app).post('/contacts').set(auth).send(contact);
    expect(again.status).toBe(200);
  });

  it('can be told to fail with 503', async () => {
    const res = await request(build(1, () => 0)).post('/contacts').set(auth).send(contact);
    expect(res.status).toBe(503);
  });

  it('works with its default options', async () => {
    const app = createMockCrm();
    expect((await request(app).post('/contacts').set('Authorization', 'Bearer dev-crm-key').send(contact)).status).toBe(201);
  });
});
