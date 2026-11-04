import { CrmError, type CrmClient } from '../crm/crmClient';
import type { EventRepository } from '../events/repository';

export interface ForwarderOptions {
  /** Attempts per forward() call, including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type ForwardOutcome =
  | { outcome: 'forwarded'; attempts: number }
  | { outcome: 'failed'; attempts: number }
  | { outcome: 'skipped'; attempts: number; reason: 'not_found' | 'invalid_transition' };

/**
 * Exponential backoff with full jitter: wait a random time between 0 and
 * min(maxDelay, base * 2^(attempt-1)). Jitter stops many failed events retrying in lockstep
 * and hammering a CRM that is trying to recover. `attempt` counts from 1.
 */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * cap);
}

const MAX_ERROR_LENGTH = 500;

export class Forwarder {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly events: EventRepository,
    private readonly crm: CrmClient,
    options: ForwarderOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  /**
   * Push one stored event to the CRM, retrying transient failures.
   * Each attempt first moves the event to 'retrying' (which counts the attempt), so the database
   * always shows what is happening. A non-retryable error, or running out of attempts, ends in
   * 'failed' with the reason. If the event is already forwarded (or missing) nothing is sent.
   */
  async forward(eventId: string): Promise<ForwardOutcome> {
    let attempt = 0;

    for (;;) {
      attempt += 1;

      const started = await this.events.transition(eventId, 'retrying');
      if (!started.ok) {
        return { outcome: 'skipped', attempts: attempt - 1, reason: started.reason };
      }

      try {
        await this.crm.createContact(started.record.payload);
        const done = await this.events.transition(eventId, 'forwarded');
        return done.ok
          ? { outcome: 'forwarded', attempts: attempt }
          : { outcome: 'skipped', attempts: attempt, reason: done.reason };
      } catch (err) {
        const retryable = err instanceof CrmError ? err.retryable : true;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH);

        if (!retryable || attempt >= this.maxAttempts) {
          await this.events.transition(eventId, 'failed', message);
          return { outcome: 'failed', attempts: attempt };
        }

        await this.sleep(backoffDelay(attempt, this.baseDelayMs, this.maxDelayMs, this.random));
      }
    }
  }
}
