export type IdentifierStatus = 'idle' | 'checking' | 'registered' | 'available' | 'blocked';

export function passwordStrength(password: string) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (password.length >= 12) score++;
  if (score <= 2) return { label: 'Weak', color: 'bg-red-500', text: 'text-red-400', score };
  if (score <= 4) return { label: 'Medium', color: 'bg-yellow-500', text: 'text-yellow-400', score };
  return { label: 'Strong', color: 'bg-green-500', text: 'text-green-400', score };
}

export function isProbablyRegistered(identifier: string) {
  return /registered|demo|test|user|@tigerex/i.test(identifier) || identifier.replace(/\D/g, '').endsWith('0000');
}

export const socialProviders = ['Google', 'Apple', 'Telegram', 'Facebook', 'X', 'LinkedIn', 'Discord', 'Line', 'WeChat'];
export const livenessPrompts = ['Blink twice', 'Turn your head left', 'Turn your head right', 'Smile', 'Read the numbers 7 2 9'];
