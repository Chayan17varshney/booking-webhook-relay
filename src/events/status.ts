export const STATUSES = ['received', 'retrying', 'forwarded', 'failed'] as const;
export type EventStatus = (typeof STATUSES)[number];

/**
 * The event lifecycle:
 *
 *   received --> retrying --> forwarded
 *       |           |  ^
 *       |           v  |
 *       +-------> failed   (failed --> retrying is a manual replay)
 *
 * forwarded is terminal. retrying --> retrying means another attempt after a failed one.
 */
export const TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  received: ['retrying', 'forwarded', 'failed'],
  retrying: ['retrying', 'forwarded', 'failed'],
  failed: ['retrying'],
  forwarded: [],
};

export function isStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Every status from which `to` may be reached. */
export function allowedFrom(to: EventStatus): EventStatus[] {
  return STATUSES.filter((from) => canTransition(from, to));
}
