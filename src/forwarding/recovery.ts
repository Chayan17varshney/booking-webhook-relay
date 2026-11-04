import type { EventRepository } from '../events/repository';
import type { Forwarder } from './forwarder';

/**
 * Forwarding runs in-process, so a crash or deploy can leave events stuck in 'received' or
 * 'retrying'. This finds events that have not changed for `olderThanSeconds` and forwards
 * them again. Postgres is the queue; the threshold should exceed the longest backoff so a
 * healthy in-flight attempt is not picked up twice.
 */
export async function recoverPending(
  events: EventRepository,
  forwarder: Forwarder,
  olderThanSeconds = 60,
  limit = 100,
): Promise<number> {
  const ids = await events.findStuck(olderThanSeconds, limit);
  for (const id of ids) {
    await forwarder.forward(id);
  }
  return ids.length;
}
