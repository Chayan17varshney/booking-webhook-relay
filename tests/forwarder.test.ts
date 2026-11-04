import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { CrmError, HttpCrmClient, type CrmClient } from '../src/crm/crmClient';
import type { Db } from '../src/db/db';
import { EventRepository } from '../src/events/repository';
import { backoffDelay, Forwarder } from '../src/forwarding/forwarder';
import { recoverPending } from '../src/forwarding/recovery';
import { createMockCrm } from '../src/mockCrm/app';
import type { BookingEvent } from '../src/webhook/schema';
import { createTestDb } from './helpers/testDb';

const makeEvent = (id: string): BookingEvent => ({
  id,
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
});

describe('backoffDelay', () => {
  it('grows exponentially up to the cap', () => {
    const max = () => 0.999999;
    expect(backoffDelay(1, 100, 10_000, max)).toBe(99);
    expect(backoffDelay(2, 100, 10_000, max)).toBe(199);
    expect(backoffDelay(3, 100, 10_000, max)).toBe(399);
    expect(backoffDelay(10, 100, 1_000, max)).toBe(999); // capped at maxDelay
  });

  it('applies full jitter between 0 and the cap', () => {
    expect(backoffDelay(3, 100, 10_000, () => 0)).toBe(0);
    expect(backoffDelay(3, 100, 10_000, () => 0.5)).toBe(200);
  });
});

describe('Forwarder', () => {
  let db: Db & { close(): Promise<void> };
  let events: EventRepository;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  const build = (crm: CrmClient, maxAttempts = 4) =>
    new Forwarder(events, crm, { maxAttempts, baseDelayMs: 100, maxDelayMs: 10_000, sleep, random: () => 0.5 });

  beforeEach(async () => {
    sleeps.length = 0;
    db = await createTestDb();
    events = new EventRepository(db);
    await events.insertReceived(makeEvent('evt_1'));
  });

  afterEach(async () => {
    await db.close();
  });

  it('forwards on the first attempt', async () => {
    const crm = { createContact: jest.fn().mockResolvedValue(undefined) };
    const result = await build(crm).forward('evt_1');
    expect(result).toEqual({ outcome: 'forwarded', attempts: 1 });
    const stored = await events.getById('evt_1');
    expect(stored?.status).toBe('forwarded');
    expect(stored?.attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    const crm = {
      createContact: jest
        .fn()
        .mockRejectedValueOnce(new CrmError('HTTP 503', true, 503))
        .mockRejectedValueOnce(new CrmError('HTTP 503', true, 503))
        .mockResolvedValue(undefined),
    };
    const result = await build(crm).forward('evt_1');
    expect(result).toEqual({ outcome: 'forwarded', attempts: 3 });
    expect(sleeps).toEqual([50, 100]); // random 0.5 of caps 100 and 200
    const stored = await events.getById('evt_1');
    expect(stored?.status).toBe('forwarded');
    expect(stored?.lastError).toBeNull();
  });

  it('gives up after the maximum attempts and records the reason', async () => {
    const crm = { createContact: jest.fn().mockRejectedValue(new CrmError('CRM responded with HTTP 503', true, 503)) };
    const result = await build(crm, 3).forward('evt_1');
    expect(result).toEqual({ outcome: 'failed', attempts: 3 });
    expect(crm.createContact).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2); // no sleep after the final attempt
    const stored = await events.getById('evt_1');
    expect(stored?.status).toBe('failed');
    expect(stored?.attempts).toBe(3);
    expect(stored?.lastError).toBe('CRM responded with HTTP 503');
  });

  it('fails immediately on a non-retryable error', async () => {
    const crm = { createContact: jest.fn().mockRejectedValue(new CrmError('HTTP 400', false, 400)) };
    const result = await build(crm).forward('evt_1');
    expect(result).toEqual({ outcome: 'failed', attempts: 1 });
    expect(sleeps).toEqual([]);
  });

  it('treats an unexpected error as retryable', async () => {
    const crm = {
      createContact: jest.fn().mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValue(undefined),
    };
    const result = await build(crm).forward('evt_1');
    expect(result).toEqual({ outcome: 'forwarded', attempts: 2 });
  });

  it('does not send anything for an event that is already forwarded', async () => {
    const crm = { createContact: jest.fn().mockResolvedValue(undefined) };
    await build(crm).forward('evt_1');
    crm.createContact.mockClear();
    const again = await build(crm).forward('evt_1');
    expect(again).toMatchObject({ outcome: 'skipped', reason: 'invalid_transition' });
    expect(crm.createContact).not.toHaveBeenCalled();
  });

  it('skips an unknown event', async () => {
    const crm = { createContact: jest.fn() };
    const result = await build(crm).forward('nope');
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'not_found' });
    expect(crm.createContact).not.toHaveBeenCalled();
  });

  it('can replay a failed event successfully', async () => {
    const failing = { createContact: jest.fn().mockRejectedValue(new CrmError('HTTP 503', true, 503)) };
    await build(failing, 2).forward('evt_1');
    expect((await events.getById('evt_1'))?.status).toBe('failed');

    const working = { createContact: jest.fn().mockResolvedValue(undefined) };
    const replay = await build(working).forward('evt_1');
    expect(replay).toEqual({ outcome: 'forwarded', attempts: 1 });
    const stored = await events.getById('evt_1');
    expect(stored?.status).toBe('forwarded');
    expect(stored?.attempts).toBe(3); // 2 earlier + 1 replay
    expect(stored?.lastError).toBeNull();
  });

  describe('defaults and edge cases', () => {
    it('defaults to 5 attempts and works with the built-in sleep and random', async () => {
      const crm = { createContact: jest.fn().mockRejectedValue(new CrmError('HTTP 503', true, 503)) };
      const result = await new Forwarder(events, crm, { baseDelayMs: 0 }).forward('evt_1');
      expect(result).toEqual({ outcome: 'failed', attempts: 5 });
      expect(crm.createContact).toHaveBeenCalledTimes(5);
    });

    it('skips (and stops) if the event is changed by someone else during the CRM call', async () => {
      const crm = {
        createContact: jest.fn().mockImplementation(async () => {
          await events.transition('evt_1', 'failed', 'changed elsewhere');
        }),
      };
      const result = await build(crm).forward('evt_1');
      expect(result).toEqual({ outcome: 'skipped', attempts: 1, reason: 'invalid_transition' });
      expect((await events.getById('evt_1'))?.status).toBe('failed');
    });

    it('records a non-Error rejection as text', async () => {
      const crm = { createContact: jest.fn().mockRejectedValue('plain string failure') };
      const result = await build(crm, 1).forward('evt_1');
      expect(result).toEqual({ outcome: 'failed', attempts: 1 });
      expect((await events.getById('evt_1'))?.lastError).toBe('plain string failure');
    });

    it('truncates very long error messages', async () => {
      const crm = { createContact: jest.fn().mockRejectedValue(new Error('x'.repeat(2000))) };
      await build(crm, 1).forward('evt_1');
      expect((await events.getById('evt_1'))?.lastError).toHaveLength(500);
    });
  });

  describe('recoverPending', () => {
    it('works with its default threshold and limit', async () => {
      const crm = { createContact: jest.fn() };
      expect(await recoverPending(events, build(crm))).toBe(0); // evt_1 is brand new, so nothing is stuck
    });

    it('forwards only events that have been stuck long enough', async () => {
      await events.insertReceived(makeEvent('evt_old'));
      await db.exec(`UPDATE events SET updated_at = now() - interval '5 minutes' WHERE event_id = 'evt_old'`);
      // evt_1 was inserted just now, so it is not "stuck"
      const crm = { createContact: jest.fn().mockResolvedValue(undefined) };
      const count = await recoverPending(events, build(crm), 60);
      expect(count).toBe(1);
      expect((await events.getById('evt_old'))?.status).toBe('forwarded');
      expect((await events.getById('evt_1'))?.status).toBe('received');
    });

    it('ignores failed and forwarded events', async () => {
      await events.transition('evt_1', 'failed', 'boom');
      await db.exec(`UPDATE events SET updated_at = now() - interval '5 minutes'`);
      const crm = { createContact: jest.fn() };
      expect(await recoverPending(events, build(crm), 60)).toBe(0);
    });
  });

  describe('against a real HTTP mock CRM', () => {
    let server: Server;
    let baseUrl: string;
    let crmApp: ReturnType<typeof createMockCrm>;
    const random = jest.fn();

    const start = async () => {
      crmApp = createMockCrm({ apiKey: 'crm-key', failRate: 0.5, random });
      await new Promise<void>((resolve) => {
        server = crmApp.listen(0, () => resolve());
      });
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
      random.mockReset();
    });

    it('recovers from two 503s over real HTTP and creates the contact once', async () => {
      random.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(1); // <0.5 fails, 1 succeeds
      await start();
      const crm = new HttpCrmClient({ baseUrl, apiKey: 'crm-key' });
      const result = await build(crm).forward('evt_1');
      expect(result).toEqual({ outcome: 'forwarded', attempts: 3 });

      const count = await fetch(`${baseUrl}/contacts/count`).then((r) => r.json());
      expect(count).toEqual({ count: 1 });
    });

    it('fails without retrying when the CRM rejects the API key', async () => {
      random.mockReturnValue(1);
      await start();
      const crm = new HttpCrmClient({ baseUrl, apiKey: 'wrong-key' });
      const result = await build(crm).forward('evt_1');
      expect(result).toEqual({ outcome: 'failed', attempts: 1 });
      expect((await events.getById('evt_1'))?.lastError).toBe('CRM responded with HTTP 401');
    });
  });
});
