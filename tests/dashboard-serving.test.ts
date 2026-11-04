import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { API_KEY_HEADER } from '../src/auth';
import { EventRepository } from '../src/events/repository';
import { createTestDb } from './helpers/testDb';

describe('dashboard serving', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hi")');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves the built files with a strict Content-Security-Policy', async () => {
    const app = createApp({ dashboardDir: dir });
    const res = await request(app).get('/dashboard/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect((await request(app).get('/dashboard/app.js')).status).toBe(200);
  });

  it('redirects the root to the dashboard', async () => {
    const res = await request(createApp({ dashboardDir: dir })).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard/');
  });

  it('does not serve a dashboard (or redirect) when none is configured', async () => {
    const app = createApp();
    expect((await request(app).get('/dashboard/')).status).toBe(404);
    expect((await request(app).get('/')).status).toBe(404);
  });

  it('exposes event counts at /events/stats behind the API key', async () => {
    const db = await createTestDb();
    const repo = new EventRepository(db);
    const app = createApp({ adminApiKey: 'k', events: repo });
    expect((await request(app).get('/events/stats')).status).toBe(401);
    const res = await request(app).get('/events/stats').set(API_KEY_HEADER, 'k');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 0, retrying: 0, forwarded: 0, failed: 0, total: 0 });
    await db.close();
  });
});
