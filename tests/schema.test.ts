import { parseBookingEvent } from '../src/webhook/schema';

const valid = {
  id: 'evt_1',
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
};

describe('parseBookingEvent', () => {
  it('accepts a valid event and normalises the phone to E.164', () => {
    const result = parseBookingEvent(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer.phone).toBe('+919876543210');
    }
  });

  it('drops an invalid phone but still accepts the event (the Brevo HTTP 400 lesson)', () => {
    const result = parseBookingEvent({
      ...valid,
      customer: { ...valid.customer, phone: '12345' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer.phone).toBeUndefined();
    }
  });

  it('accepts an event with no phone at all', () => {
    const result = parseBookingEvent({
      ...valid,
      customer: { name: 'Asha Rao', email: 'asha@example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing email', () => {
    const result = parseBookingEvent({ ...valid, customer: { name: 'Asha Rao' } });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    expect(parseBookingEvent({ ...valid, type: 'booking.deleted' }).success).toBe(false);
  });

  it('rejects an invalid startsAt', () => {
    expect(parseBookingEvent({ ...valid, startsAt: 'next tuesday' }).success).toBe(false);
  });

  it('returns readable error messages on failure', () => {
    const result = parseBookingEvent({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('parseBookingEvent with unusual input', () => {
  it.each([[null], [undefined], ['a string'], [42], [[]]])('rejects %p with a readable message', (input) => {
    const result = parseBookingEvent(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toEqual(expect.any(String));
    }
  });

  it('drops a phone that is not a string instead of rejecting the event', () => {
    const result = parseBookingEvent({
      id: 'evt_1',
      type: 'booking.created',
      customer: { name: 'Asha Rao', email: 'asha@example.com', phone: 9876543210 },
      service: 'Discovery call',
      startsAt: '2026-12-01T10:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer.phone).toBeUndefined();
    }
  });

  it('accepts an ISO timestamp with a time zone offset', () => {
    const result = parseBookingEvent({
      id: 'evt_1',
      type: 'booking.created',
      customer: { name: 'Asha Rao', email: 'asha@example.com' },
      service: 'Discovery call',
      startsAt: '2026-12-01T15:30:00+05:30',
    });
    expect(result.success).toBe(true);
  });
});
