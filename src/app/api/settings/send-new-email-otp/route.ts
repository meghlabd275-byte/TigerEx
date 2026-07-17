import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { code: string; expires: number }>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;
    
    if (!email) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Email required' } }, { status: 400 });
    }
    
    const otp = generateOTP();
    otpStore.set(`new:${email}`, { code: otp, expires: Date.now() + 300000 });
    
    console.log(`New email OTP for ${email}: ${otp}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Code sent',
      debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined 
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed' } }, { status: 500 });
  }
}
