import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { code: string; expires: number }>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, code } = body;
    
    if (!emailOrPhone || !code) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'All fields are required' } },
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
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'Invalid code' } },
        { status: 400 }
      );
    }
    
    // Mark as verified
    otpStore.set(emailOrPhone, { code: 'VERIFIED', expires: Date.now() + 3600000 });
    
    return NextResponse.json({
      success: true,
      message: 'Identity verified successfully',
    });
  } catch (error: any) {
    console.error('Verify KYC OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
