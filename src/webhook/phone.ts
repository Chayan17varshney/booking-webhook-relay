import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalise a phone number to E.164 (for example "+919876543210").
 * Returns null when the number is missing or invalid, instead of throwing,
 * so the caller can drop the field and still create the contact.
 * (This mirrors the real Brevo HTTP 400 fix at Unfazed: an invalid phone number
 * used to fail the whole request.)
 */
export function normalisePhone(
  raw: string | null | undefined,
  defaultCountry: string = 'IN',
): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry as CountryCode);
    return parsed && parsed.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}
