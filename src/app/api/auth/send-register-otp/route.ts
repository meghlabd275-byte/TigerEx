import { NextRequest, NextResponse } from 'next/server';

// In-memory OTP storage (would be Redis in production)
const otpStore = new Map<string, { code: string; expires: number; attempts: number }>();

// Generate random 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, type } = body;
    
    if (!emailOrPhone) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Email or phone is required' } },
        { status: 400 }
      );
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
    
    // Store OTP
    otpStore.set(emailOrPhone, { code: otp, expires, attempts: 0 });
    
    // In production, send OTP via email/SMS
    console.log(`OTP for ${emailOrPhone}: ${otp}`);
    
    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
      // For demo purposes, include OTP in response (remove in production)
      debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined,
    });
  } catch (error: any) {
    console.error('Send register OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send verification code' } },
      { status: 500 }
    );
  }
}
