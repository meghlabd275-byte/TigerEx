import { NextRequest, NextResponse } from 'next/server';

// In-memory OTP storage
const otpStore = new Map<string, { code: string; expires: number; verified: boolean }>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, code } = body;
    
    if (!emailOrPhone || !code) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Email/phone and code are required' } },
        { status: 400 }
      );
    }
    
    // Find OTP record
    const otpRecord = otpStore.get(emailOrPhone);
    
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'No verification code found. Please request a new code.' } },
        { status: 400 }
      );
    }
    
    // Check if expired
    if (Date.now() > otpRecord.expires) {
      otpStore.delete(emailOrPhone);
      return NextResponse.json(
        { success: false, error: { code: 'OTP_EXPIRED', message: 'Verification code has expired. Please request a new one.' } },
        { status: 400 }
      );
    }
    
    // Verify code
    if (otpRecord.code !== code) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'Invalid verification code' } },
        { status: 400 }
      );
    }
    
    // Mark as verified
    otpRecord.verified = true;
    otpStore.set(emailOrPhone, otpRecord);
    
    return NextResponse.json({
      success: true,
      message: 'Email/phone verified successfully',
    });
  } catch (error: any) {
    console.error('Verify register OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
