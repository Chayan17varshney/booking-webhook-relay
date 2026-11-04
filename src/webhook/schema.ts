import { z } from 'zod';
import { config } from '../config';
import { normalisePhone } from './phone';

export interface BookingEvent {
  id: string;
  type: 'booking.created';
  customer: {
    name: string;
    email: string;
    /** E.164 when valid; undefined when the supplied number was missing or invalid. */
    phone?: string;
  };
  service: string;
  startsAt: string; // ISO 8601
}

export type ParseResult =
  | { success: true; data: BookingEvent }
  | { success: false; errors: string[] };

const bookingSchema = z.object({
  id: z.string().min(1),
  type: z.literal('booking.created'),
  customer: z.object({
    name: z.string().min(1),
    email: z.email(),
    // Accept anything here: an unusable phone must never reject the whole event.
    phone: z.unknown().optional(),
  }),
  service: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }),
});

/**
 * Validate an incoming booking webhook payload.
 *
 * id, customer.name, customer.email, service and startsAt are required, and type must be
 * "booking.created". customer.phone is optional and is normalised to E.164; if it is
 * missing or invalid the field is dropped but the event is still accepted.
 */
export function parseBookingEvent(input: unknown): ParseResult {
  const result = bookingSchema.safeParse(input);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }

  const { customer, ...rest } = result.data;
  const phone =
    typeof customer.phone === 'string'
      ? (normalisePhone(customer.phone, config.defaultPhoneCountry) ?? undefined)
      : undefined;

  return {
    success: true,
    data: {
      ...rest,
      customer: {
        name: customer.name,
        email: customer.email,
        ...(phone ? { phone } : {}),
      },
    },
  };
}
