import { getSupportedCountries } from './countries';

export type IdentityType = 'email' | 'phone' | 'empty';

export interface IdentityState {
  raw: string;
  type: IdentityType;
  normalized: string;
  isValid: boolean;
  validationMessage: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function detectIdentityType(value: string): IdentityType {
  const trimmed = value.trim();
  if (!trimmed) return 'empty';
  const numericChars = trimmed.replace(/[\s()+\-.]/g, '');
  if (/^\+?[\d\s()+\-.]+$/.test(trimmed) && /\d/.test(numericChars)) return 'phone';
  return 'email';
}

export function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 15);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 11) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7, 11)} ${digits.slice(11)}`;
}

export function buildIdentityState(raw: string, countryRegion = 'US'): IdentityState {
  const type = detectIdentityType(raw);
  const countries = getSupportedCountries();
  const country = countries.find((item) => item.region === countryRegion) || countries[0];

  if (type === 'empty') {
    return { raw, type, normalized: '', isValid: false, validationMessage: 'Enter email or phone.' };
  }

  if (type === 'email') {
    const normalized = raw.trim().toLowerCase();
    return {
      raw,
      type,
      normalized,
      isValid: emailPattern.test(normalized),
      validationMessage: emailPattern.test(normalized) ? 'Valid email.' : 'Enter a valid email address.',
    };
  }

  const digits = raw.replace(/\D/g, '');
  const normalized = `${country?.dialCode || '+'}${digits}`;
  const valid = digits.length >= 6 && digits.length <= 15 && Boolean(country?.dialCode && country.dialCode !== '+');
  return {
    raw,
    type,
    normalized,
    isValid: valid,
    validationMessage: valid ? 'Valid phone format.' : 'Enter a valid international phone number.',
  };
}
