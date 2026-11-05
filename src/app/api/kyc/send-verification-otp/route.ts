import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import { issueOtp } from '@/lib/security/otp';

/**
 * Send an identity-verification code for the KYC flow.
 *
 * The code goes to the address already on the account, chosen from the account
 * rather than the request body, so this cannot be used to send codes to an
 * arbitrary address. Delivery failures are surfaced, never reported as sent.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'kyc-identity-otp', 5, 60_000);
  if (guard) return guard;

  const body = (await readJson(request)) ?? {};
  const channel = String(body.type ?? 'email').toLowerCase();

  const destination =
    channel === 'phone'
      ? { phone: auth.user.phone, purpose: 'phone_verify' as const }
      : { email: auth.user.email, purpose: 'email_verify' as const };

  if (channel === 'phone' ? !destination.phone : !destination.email) {
    return fail('NO_DESTINATION', `No ${channel} address is on file for this account`);
  }

  const result = await issueOtp({
    purpose: destination.purpose,
    userId: auth.user.userId,
    email: destination.email ?? null,
    phone: destination.phone ?? null,
  });

  if (!result.delivered) {
    return fail(
      result.reason === 'EMAIL_DELIVERY_NOT_CONFIGURED' || result.reason === 'SMS_DELIVERY_NOT_CONFIGURED'
        ? 'DELIVERY_NOT_CONFIGURED'
        : result.reason || 'DELIVERY_FAILED',
      'The verification code could not be delivered',
      503,
    );
  }

  return NextResponse.json({ success: true, data: { sent: true } }, { headers: NO_STORE });
}
