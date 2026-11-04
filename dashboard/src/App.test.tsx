import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { EventRecord, EventStatus } from './api/types';
import { initialState, useStore } from './store';

const NOW = Date.now();

function makeEvent(id: string, status: EventStatus = 'forwarded', overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    eventId: id,
    type: 'booking.created',
    status,
    payload: {
      id,
      type: 'booking.created',
      customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' },
      service: 'Discovery call',
      startsAt: '2026-12-01T10:00:00Z',
    },
    attempts: status === 'received' ? 0 : 1,
    lastError: status === 'failed' ? 'CRM responded with HTTP 503' : null,
    receivedAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
    updatedAt: new Date(NOW - 60 * 1000).toISOString(),
    forwardedAt: status === 'forwarded' ? new Date(NOW - 60 * 1000).toISOString() : null,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Server {
  events: EventRecord[];
  replayResponse?: () => Response;
  failWith?: () => Response | Error;
}

/** A tiny fake of the relay API that answers the way the real one does. */
function startFakeServer(server: Server) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (server.failWith) {
      const failure = server.failWith();
      if (failure instanceof Error) throw failure;
      return failure;
    }
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';

    if (url.pathname === '/events/stats') {
      const counts = { received: 0, retrying: 0, forwarded: 0, failed: 0 };
      for (const e of server.events) counts[e.status] += 1;
      return json({ ...counts, total: server.events.length });
    }
    if (url.pathname === '/events') {
      const status = url.searchParams.get('status');
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      const matching = server.events.filter((e) => !status || e.status === status);
      return json({ items: matching.slice(offset, offset + limit), total: matching.length, limit, offset });
    }
    const replay = /^\/events\/([^/]+)\/replay$/.exec(url.pathname);
    if (replay && method === 'POST') {
      return server.replayResponse ? server.replayResponse() : json({ status: 'replay_scheduled', eventId: replay[1] }, 202);
    }
    const one = /^\/events\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const found = server.events.find((e) => e.eventId === decodeURIComponent(one[1]));
      return found ? json(found) : json({ error: 'not_found' }, 404);
    }
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const urlsCalled = (fetchMock: ReturnType<typeof startFakeServer>) =>
  fetchMock.mock.calls.map(([input]) => String(input));

async function signIn(user: ReturnType<typeof userEvent.setup>, key = 'good-key') {
  await user.type(screen.getByLabelText('Admin API key'), key);
  await user.click(screen.getByRole('button', { name: 'Connect' }));
}

beforeEach(() => {
  useStore.setState(initialState, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dashboard', () => {
  it('asks for the API key first and sends nothing until it is entered', () => {
    const fetchMock = startFakeServer({ events: [] });
    render(<App />);
    expect(screen.getByLabelText('Admin API key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads events and per-status counts after connecting, with customer emails masked', async () => {
    startFakeServer({ events: [makeEvent('evt_1'), makeEvent('evt_2', 'failed'), makeEvent('evt_3', 'retrying')] });
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);

    expect(await screen.findByRole('button', { name: 'Open details for evt_1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Failed\s*1$/ })).toBeInTheDocument();
    expect(screen.getAllByText('a***@example.com')).toHaveLength(3);
    expect(screen.queryByText('asha@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('CRM responded with HTTP 503')).toBeInTheDocument();
  });

  it('sends the API key with every request', async () => {
    const fetchMock = startFakeServer({ events: [makeEvent('evt_1')] });
    const user = userEvent.setup();
    render(<App />);
    await signIn(user, 'my-admin-key');
    await screen.findByText('evt_1');
    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('my-admin-key');
    }
  });

  it('filters by status and returns to the first page', async () => {
    const fetchMock = startFakeServer({ events: [makeEvent('evt_1'), makeEvent('evt_2', 'failed')] });
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await screen.findByText('evt_1');

    await user.click(screen.getByRole('button', { name: /^Failed/ }));
    await waitFor(() => expect(urlsCalled(fetchMock)).toContain('/events?limit=25&offset=0&status=failed'));
    await waitFor(() => expect(screen.queryByText('evt_1')).not.toBeInTheDocument());
    expect(screen.getByText('evt_2')).toBeInTheDocument();
  });

  it('pages through results 25 at a time', async () => {
    const many = Array.from({ length: 60 }, (_, i) => makeEvent(`evt_${String(i).padStart(2, '0')}`));
    const fetchMock = startFakeServer({ events: many });
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);

    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 26–50 of 60')).toBeInTheDocument();
    expect(urlsCalled(fetchMock)).toContain('/events?limit=25&offset=25');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 51–60 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows a friendly empty state, and a filtered one', async () => {
    startFakeServer({ events: [] });
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    expect(await screen.findByText(/No events yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Failed/ }));
    expect(await screen.findByText('No failed events.')).toBeInTheDocument();
  });

  describe('event details', () => {
    it('opens a dialog with the full details, and closes with Escape', async () => {
      startFakeServer({ events: [makeEvent('evt_1', 'forwarded')] });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);

      await user.click(await screen.findByRole('button', { name: 'Open details for evt_1' }));
      const dialog = await screen.findByRole('dialog', { name: 'evt_1' });
      expect(await within(dialog).findByText('asha@example.com')).toBeInTheDocument(); // unmasked in the detail view
      expect(within(dialog).getByText('+919876543210')).toBeInTheDocument();
      expect(within(dialog).getByText(/"service": "Discovery call"/)).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /Replay/ })).not.toBeInTheDocument();

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('moves focus into the dialog and gives it back when closed', async () => {
      startFakeServer({ events: [makeEvent('evt_1')] });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);

      const opener = await screen.findByRole('button', { name: 'Open details for evt_1' });
      await user.click(opener);
      expect(await screen.findByRole('button', { name: 'Close' })).toHaveFocus();

      await user.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(opener).toHaveFocus());
    });

    it('keeps Tab inside the dialog', async () => {
      startFakeServer({ events: [makeEvent('evt_1', 'failed')] });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);
      await user.click(await screen.findByRole('button', { name: 'Open details for evt_1' }));
      await screen.findByRole('button', { name: 'Replay this event' });

      // Close -> Replay -> (wraps) Close
      await user.tab();
      expect(screen.getByRole('button', { name: 'Replay this event' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    it('shows an error when the event cannot be loaded', async () => {
      startFakeServer({ events: [] });
      const user = userEvent.setup();
      useStore.setState({ apiKey: 'good-key', selectedId: 'missing_event' });
      render(<App />);
      expect(await screen.findByText('That event no longer exists.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Close' }));
    });
  });

  describe('replay', () => {
    it('is offered for failed events, posts the replay and confirms', async () => {
      const fetchMock = startFakeServer({ events: [makeEvent('evt_9', 'failed')] });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);

      await user.click(await screen.findByRole('button', { name: 'Open details for evt_9' }));
      await user.click(await screen.findByRole('button', { name: 'Replay this event' }));

      expect(await screen.findByText(/Replay scheduled/)).toBeInTheDocument();
      const replayCall = fetchMock.mock.calls.find(([input]) => String(input) === '/events/evt_9/replay');
      expect(replayCall?.[1]?.method).toBe('POST');
      // The list reloads after a replay so the new status shows up.
      await waitFor(() => expect(urlsCalled(fetchMock).filter((u) => u.startsWith('/events?')).length).toBeGreaterThan(1));
    });

    it('shows the server message when the replay is refused', async () => {
      startFakeServer({
        events: [makeEvent('evt_9', 'failed')],
        replayResponse: () => json({ error: 'not_replayable' }, 409),
      });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);
      await user.click(await screen.findByRole('button', { name: 'Open details for evt_9' }));
      await user.click(await screen.findByRole('button', { name: 'Replay this event' }));
      expect(await screen.findByText('Only failed events can be replayed.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Replay this event' })).toBeEnabled();
    });
  });

  describe('errors and sign out', () => {
    it('returns to the key form with a message when the key is rejected', async () => {
      startFakeServer({ events: [], failWith: () => json({ error: 'unauthorized' }, 401) });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user, 'wrong-key');

      expect(await screen.findByRole('alert')).toHaveTextContent('The API key was rejected. Enter it again.');
      expect(screen.getByLabelText('Admin API key')).toHaveValue('');
      expect(useStore.getState().apiKey).toBeNull();
    });

    it('shows a retryable error banner when the server cannot be reached', async () => {
      const server: Server = { events: [makeEvent('evt_1')], failWith: () => new TypeError('Failed to fetch') };
      const fetchMock = startFakeServer(server);
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);

      expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');

      server.failWith = undefined; // the server comes back
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('evt_1')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalled();
    });

    it('signs out: forgets the key and shows the key form', async () => {
      startFakeServer({ events: [makeEvent('evt_1')] });
      const user = userEvent.setup();
      render(<App />);
      await signIn(user);
      await screen.findByText('evt_1');

      await user.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(screen.getByLabelText('Admin API key')).toBeInTheDocument();
      expect(useStore.getState().apiKey).toBeNull();
    });
  });

  it('refreshes on demand', async () => {
    const fetchMock = startFakeServer({ events: [makeEvent('evt_1')] });
    const user = userEvent.setup();
    render(<App />);
    await signIn(user);
    await screen.findByText('evt_1');
    const before = urlsCalled(fetchMock).filter((u) => u.startsWith('/events?')).length;

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(urlsCalled(fetchMock).filter((u) => u.startsWith('/events?')).length).toBe(before + 1));
  });
});
