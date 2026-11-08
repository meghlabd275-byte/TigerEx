/**
 * Password policy.
 *
 * One shared rule set for registration, reset and change so a password cannot
 * be strong on one path and weak on another. Kept free of `next/server` so it
 * can be unit tested directly.
 */

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

/** Common passwords are refused outright, regardless of their shape. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'iloveyou1',
  'admin12345',
  'welcome123',
  'changeme1',
]);

/**
 * Evaluate a password against the policy.
 *
 * A password must be long enough, mix character classes, not repeat a single
 * character, and not appear in the small common-password list. The result lists
 * every problem so the client can show them together.
 */
export function checkPassword(password: string): PasswordCheck {
  const problems: string[] = [];
  const value = String(password ?? '');

  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(`At least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    problems.push(`At most ${MAX_PASSWORD_LENGTH} characters`);
  }
  if (!/[a-z]/.test(value)) problems.push('One lowercase letter');
  if (!/[A-Z]/.test(value)) problems.push('One uppercase letter');
  if (!/[0-9]/.test(value)) problems.push('One number');
  if (!/[^A-Za-z0-9]/.test(value)) problems.push('One special character');
  if (value.length > 0 && new Set(value).size < 5) problems.push('More distinct characters');
  if (COMMON_PASSWORDS.has(value.toLowerCase())) problems.push('Not a commonly used password');

  return { ok: problems.length === 0, problems };
}

/** Convenience boolean form. */
export function isStrongPassword(password: string): boolean {
  return checkPassword(password).ok;
}
