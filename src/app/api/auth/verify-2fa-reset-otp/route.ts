import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { email: string; phone: string; expires: number; verified: { email: boolean; phone: boolean } }>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, code, type } = body;
    
    if (!emailOrPhone || !code || !type) {
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
    
    // Verify based on type
    let isValid = false;
    if (type === 'email' && otpRecord.email === code) {
      otpRecord.verified.email = true;
      isValid = true;
    } else if (type === 'phone' && otpRecord.phone === code) {
      otpRecord.verified.phone = true;
      isValid = true;
    }
    
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'Invalid code' } },
        { status: 400 }
      );
    }
    
    // Save updated record
    otpStore.set(emailOrPhone, otpRecord);
    
    return NextResponse.json({
      success: true,
      message: `${type} verified successfully`,
      verified: otpRecord.verified,
    });
  } catch (error: any) {
    console.error('Verify 2FA reset OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
