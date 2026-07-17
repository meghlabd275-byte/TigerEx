import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { code: string; expires: number }>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, code } = body;
    
    if (!email || !code) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'All fields required' } }, { status: 400 });
    }
    
    const otpRecord = otpStore.get(`new:${email}`);
    
    if (!otpRecord || otpRecord.code !== code) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_OTP', message: 'Invalid code' } }, { status: 400 });
    }
    
    if (Date.now() > otpRecord.expires) {
      return NextResponse.json({ success: false, error: { code: 'OTP_EXPIRED', message: 'Code expired' } }, { status: 400 });
    }
    
    otpStore.set(`new:${email}`, { code: 'VERIFIED', expires: Date.now() + 3600000 });
    
    return NextResponse.json({ success: true, message: 'Verified' });
  } catch (error) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed' } }, { status: 500 });
  }
}
