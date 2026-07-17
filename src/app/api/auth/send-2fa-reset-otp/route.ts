import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { email: string; phone: string; expires: number }>();

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
    
    // Generate OTPs for both email and phone
    const emailOtp = generateOTP();
    const phoneOtp = generateOTP();
    const expires = Date.now() + 5 * 60 * 1000;
    
    otpStore.set(emailOrPhone, { 
      email: emailOtp, 
      phone: phoneOtp, 
      expires 
    });
    
    console.log(`2FA Reset OTPs for ${emailOrPhone}: Email: ${emailOtp}, Phone: ${phoneOtp}`);
    
    return NextResponse.json({
      success: true,
      message: 'Verification codes sent',
      debugEmailOtp: process.env.NODE_ENV === 'development' ? emailOtp : undefined,
      debugPhoneOtp: process.env.NODE_ENV === 'development' ? phoneOtp : undefined,
    });
  } catch (error: any) {
    console.error('Send 2FA reset OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send codes' } },
      { status: 500 }
    );
  }
}
