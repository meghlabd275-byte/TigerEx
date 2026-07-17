import { NextRequest, NextResponse } from 'next/server';

// In-memory OTP storage
const otpStore = new Map<string, { code: string; expires: number; attempts: number }>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, code, trustedDevice } = body;
    
    if (!emailOrPhone || !code) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Email/phone and code are required' } },
        { status: 400 }
      );
    }
    
    const otpRecord = otpStore.get(emailOrPhone);
    
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'No verification code found' } },
        { status: 400 }
      );
    }
    
    if (Date.now() > otpRecord.expires) {
      otpStore.delete(emailOrPhone);
      return NextResponse.json(
        { success: false, error: { code: 'OTP_EXPIRED', message: 'Code has expired' } },
        { status: 400 }
      );
    }
    
    if (otpRecord.code !== code) {
      otpRecord.attempts++;
      if (otpRecord.attempts >= 3) {
        otpStore.delete(emailOrPhone);
        return NextResponse.json(
          { success: false, error: { code: 'OTP_LOCKED', message: 'Too many attempts. Please request a new code.' } },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'Invalid code' } },
        { status: 400 }
      );
    }
    
    // Generate tokens
    const accessToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ emailOrPhone, trustedDevice })).toString('base64')}.demo`;
    const refreshToken = `refresh_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    // Clean up OTP
    otpStore.delete(emailOrPhone);
    
    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: 'user_' + Date.now(),
        email: emailOrPhone.includes('@') ? emailOrPhone : null,
        phone: emailOrPhone.includes('@') ? null : emailOrPhone,
        username: emailOrPhone.split('@')[0] || emailOrPhone,
        kycLevel: 0,
        status: 'active',
      },
    });
  } catch (error: any) {
    console.error('Verify login OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
