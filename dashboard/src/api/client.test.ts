import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, UnauthorizedError } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(response: Response | Error | DOMException) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Response) return response;
    throw response; // anything else is an error to reject with (DOMException is not always an Error subclass in jsdom)
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends the API key and builds the query string', async () => {
    const fetchMock = stubFetch(json({ items: [], total: 0, limit: 25, offset: 50 }));
    await api.listEvents('secret-key', { status: 'failed', limit: 25, offset: 50 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/events?limit=25&offset=50&status=failed');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
  });

  it('omits the status parameter when no filter is set', async () => {
    const fetchMock = stubFetch(json({ items: [], total: 0, limit: 25, offset: 0 }));
    await api.listEvents('k', { limit: 25, offset: 0 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/events?limit=25&offset=0');
  });

  it('encodes event ids in the path', async () => {
    const fetchMock = stubFetch(json({}));
    await api.getEvent('k', 'evt/with space');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/events/evt%2Fwith%20space');
  });

  it('posts replays', async () => {
    const fetchMock = stubFetch(json({ status: 'replay_scheduled', eventId: 'evt_1' }, 202));
    await api.replay('k', 'evt_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/events/evt_1/replay');
    expect(init.method).toBe('POST');
  });

  it('throws UnauthorizedError on HTTP 401', async () => {
    stubFetch(json({ error: 'unauthorized' }, 401));
    await expect(api.getStats('bad')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each([
    ['not_replayable', 409, 'Only failed events can be replayed.'],
    ['server_misconfigured', 500, 'The server has no admin API key configured.'],
    ['forwarding_not_configured', 503, 'CRM forwarding is not configured on the server, so replay is unavailable.'],
  ])('maps the %s error to a readable message', async (code, status, message) => {
    stubFetch(json({ error: code }, status));
    await expect(api.replay('k', 'evt_1')).rejects.toMatchObject({ message, status, code });
  });

  it('falls back to a generic message for unknown errors and non-JSON bodies', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.getStats('k')).rejects.toMatchObject({ message: 'Request failed (HTTP 502).', status: 502 });
  });

  it('reports an unreachable server as status 0', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    const err = await api.getStats('k').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: 'Cannot reach the server. Check that it is running.' });
  });

  it('lets an intentional abort through unchanged', async () => {
    stubFetch(new DOMException('aborted', 'AbortError'));
    await expect(api.getStats('k')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
