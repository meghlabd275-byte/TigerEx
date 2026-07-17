import { NextRequest, NextResponse } from 'next/server';

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
    
    // Check if we have an existing OTP
    let otpRecord = otpStore.get(emailOrPhone);
    
    if (otpRecord && Date.now() < otpRecord.expires) {
      const remaining = Math.ceil((otpRecord.expires - Date.now()) / 1000);
      return NextResponse.json(
        { success: false, error: { code: 'OTP_PENDING', message: `Please wait ${remaining} seconds before requesting a new code` } },
        { status: 400 }
      );
    }
    
    // Generate new OTP
    const otp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000;
    
    otpStore.set(emailOrPhone, { code: otp, expires, attempts: 0 });
    
    console.log(`Resend OTP for ${emailOrPhone}: ${otp}`);
    
    return NextResponse.json({
      success: true,
      message: 'Verification code resent',
      debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    });
  } catch (error: any) {
    console.error('Resend login OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resend code' } },
      { status: 500 }
    );
  }
}
