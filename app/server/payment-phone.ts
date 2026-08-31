import parsePhoneNumberFromString, { type CountryCode } from 'libphonenumber-js/max';

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,49}$/u;
const COUNTRY_RE = /^[A-Z]{2}$/;

export function normalizePersonName(value: unknown, label: string): string {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text || !NAME_RE.test(text)) {
    throw Object.assign(new Error(`A valid ${label} is required.`), { status: 400 });
  }
  return text.slice(0, 50);
}

export function normalizeCountryCode(value: unknown): CountryCode {
  const code = String(value || '').trim().toUpperCase();
  if (!COUNTRY_RE.test(code)) {
    throw Object.assign(new Error('A valid ISO country code is required.'), { status: 400 });
  }
  return code as CountryCode;
}

export function normalizePhoneE164(phone: unknown, countryCode: CountryCode): {
  e164: string;
  nationalNumber: string;
  countryCode: CountryCode;
} {
  const raw = String(phone || '').trim();
  const parsed = parsePhoneNumberFromString(raw, countryCode);
  if (!parsed || !parsed.isValid()) {
    throw Object.assign(new Error('Enter a valid phone number for the selected country.'), { status: 400 });
  }
  if (parsed.country && parsed.country !== countryCode) {
    throw Object.assign(new Error('Phone number does not match the selected country.'), { status: 400 });
  }
  return {
    e164: parsed.format('E.164'),
    nationalNumber: parsed.nationalNumber,
    countryCode: (parsed.country || countryCode) as CountryCode,
  };
}
