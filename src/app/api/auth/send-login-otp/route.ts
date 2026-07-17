import { NextRequest, NextResponse } from 'next/server';

// In-memory OTP storage
const otpStore = new Map<string, { code: string; expires: number; attempts: number }>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone } = body;
    
    if (!emailOrPhone) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Email or phone is required' } },
        { status: 400 }
      );
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000;
    
    otpStore.set(emailOrPhone, { code: otp, expires, attempts: 0 });
    
    console.log(`Login OTP for ${emailOrPhone}: ${otp}`);
    
    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
      debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    });
  } catch (error: any) {
    console.error('Send login OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send code' } },
      { status: 500 }
    );
  }
}
