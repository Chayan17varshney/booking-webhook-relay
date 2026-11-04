import type { EventRecord, EventsPage, EventStatus, StatusCounts } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super('The API key was rejected.', 401, 'unauthorized');
    this.name = 'UnauthorizedError';
  }
}

const MESSAGES: Record<string, string> = {
  server_misconfigured: 'The server has no admin API key configured.',
  not_replayable: 'Only failed events can be replayed.',
  not_found: 'That event no longer exists.',
  forwarding_not_configured: 'CRM forwarding is not configured on the server, so replay is unavailable.',
  invalid_status: 'That status filter is not valid.',
  invalid_pagination: 'That page is not valid.',
};

async function request<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { 'X-API-Key': apiKey, ...init.headers } });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err; // the caller cancelled this request on purpose
    }
    throw new ApiError('Cannot reach the server. Check that it is running.', 0);
  }

  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const message = (body.error && MESSAGES[body.error]) || `Request failed (HTTP ${response.status}).`;
    throw new ApiError(message, response.status, body.error);
  }
  return (await response.json()) as T;
}

export interface ListParams {
  status?: EventStatus;
  limit: number;
  offset: number;
}

export const api = {
  listEvents(apiKey: string, { status, limit, offset }: ListParams, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) query.set('status', status);
    return request<EventsPage>(`/events?${query}`, apiKey, { signal });
  },

  getStats(apiKey: string, signal?: AbortSignal) {
    return request<StatusCounts>('/events/stats', apiKey, { signal });
  },

  getEvent(apiKey: string, eventId: string, signal?: AbortSignal) {
    return request<EventRecord>(`/events/${encodeURIComponent(eventId)}`, apiKey, { signal });
  },

  replay(apiKey: string, eventId: string) {
    return request<{ status: string; eventId: string }>(`/events/${encodeURIComponent(eventId)}/replay`, apiKey, {
      method: 'POST',
    });
  },
};
