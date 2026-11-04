import { describe, expect, it } from 'vitest';
import { formatDateTime, maskEmail, relativeTime, truncate } from './format';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('asha@example.com')).toBe('a***@example.com');
    expect(maskEmail('ab@x.io')).toBe('a***@x.io');
  });

  it('hides anything that is not a valid address', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('truncate', () => {
  it('leaves short text alone and shortens long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly-10', 10)).toBe('exactly-10');
    expect(truncate('this is far too long', 10)).toBe('this is f…');
  });
});

describe('formatDateTime', () => {
  it('returns a dash for missing or invalid dates', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('formats a valid ISO date', () => {
    expect(formatDateTime('2026-12-01T10:00:00Z')).toMatch(/2026/);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-11-04T12:00:00Z').getTime();
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it('describes recent, minute, hour and day differences', () => {
    expect(relativeTime(ago(10), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60), now)).toBe('5 minutes ago');
    expect(relativeTime(ago(3 * 3600), now)).toBe('3 hours ago');
    expect(relativeTime(ago(2 * 86400), now)).toBe('2 days ago');
  });

  it('returns a dash for an invalid date', () => {
    expect(relativeTime('nope', now)).toBe('—');
  });
});
