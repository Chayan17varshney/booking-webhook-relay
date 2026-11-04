export const STATUSES = ['received', 'retrying', 'forwarded', 'failed'] as const;
export type EventStatus = (typeof STATUSES)[number];

export interface BookingPayload {
  id: string;
  type: string;
  customer: { name: string; email: string; phone?: string };
  service: string;
  startsAt: string;
}

/** Mirrors what GET /events returns (dates arrive as ISO strings over JSON). */
export interface EventRecord {
  eventId: string;
  type: string;
  status: EventStatus;
  payload: BookingPayload;
  attempts: number;
  lastError: string | null;
  receivedAt: string;
  updatedAt: string;
  forwardedAt: string | null;
}

export interface EventsPage {
  items: EventRecord[];
  total: number;
  limit: number;
  offset: number;
}

export type StatusCounts = Record<EventStatus, number> & { total: number };
