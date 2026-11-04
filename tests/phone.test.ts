import { normalisePhone } from '../src/webhook/phone';

describe('normalisePhone', () => {
  it.each([
    ['+91 98765 43210', 'IN', '+919876543210'],
    ['98765 43210', 'IN', '+919876543210'],
    ['(212) 456-7890', 'US', '+12124567890'],
  ])('normalises %s (default %s) to %s', (raw, country, expected) => {
    expect(normalisePhone(raw, country)).toBe(expected);
  });

  it.each([['12345'], ['abc'], ['']])('returns null for invalid input %p', (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });
});

describe('normalisePhone robustness', () => {
  it('never throws, even for an unknown default country', () => {
    expect(normalisePhone('9876543210', 'ZZ')).toBeNull();
  });

  it('ignores surrounding whitespace', () => {
    expect(normalisePhone('   +91 98765 43210  ')).toBe('+919876543210');
  });
});
