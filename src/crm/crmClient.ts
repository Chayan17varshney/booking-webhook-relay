import type { BookingEvent } from '../webhook/schema';

/** A CRM failure. `retryable` tells the forwarder whether trying again could help. */
export class CrmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}

export interface CrmClient {
  /** Create (or update) the contact for a booking. Throws CrmError on failure. */
  createContact(event: BookingEvent): Promise<void>;
}

export interface HttpCrmClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Talks to a CRM over HTTP. Status handling:
 *   2xx                    success
 *   409                    already exists: treated as success, so a retry is harmless
 *   408, 425, 429, 5xx     transient, retryable
 *   network error/timeout  transient, retryable
 *   any other 4xx          our request is wrong, retrying cannot help: not retryable
 *
 * The event id is sent as an Idempotency-Key so a CRM that supports it can de-duplicate retries.
 * Error messages never include customer details.
 */
export class HttpCrmClient implements CrmClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpCrmClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async createContact(event: BookingEvent): Promise<void> {
    const body = {
      email: event.customer.email,
      name: event.customer.name,
      ...(event.customer.phone ? { phone: event.customer.phone } : {}),
      attributes: { bookingId: event.id, service: event.service, startsAt: event.startsAt },
    };

    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl.replace(/\/$/, '')}/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
          'Idempotency-Key': event.id,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown error';
      throw new CrmError(`CRM request failed (${reason})`, true);
    }

    if (response.ok || response.status === 409) {
      return;
    }

    const transient = [408, 425, 429].includes(response.status) || response.status >= 500;
    throw new CrmError(`CRM responded with HTTP ${response.status}`, transient, response.status);
  }
}
