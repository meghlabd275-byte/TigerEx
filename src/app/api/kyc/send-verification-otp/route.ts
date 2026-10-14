import { unavailableAuthProvider } from '@/lib/security/unavailable-auth-provider';

export async function POST() {
  return unavailableAuthProvider('otp-delivery');
}
