import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { email: string; phone: string; expires: number; verified: { email: boolean; phone: boolean } }>();

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
    
    const otpRecord = otpStore.get(emailOrPhone);
    
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_VERIFIED', message: 'Please complete verification first' } },
        { status: 400 }
      );
    }
    
    // Check if both email and phone are verified
    if (!otpRecord.verified.email || !otpRecord.verified.phone) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_VERIFIED', message: 'Please verify both email and phone' } },
        { status: 400 }
      );
    }
    
    // In production, disable 2FA in the database
    console.log(`2FA reset for ${emailOrPhone}`);
    
    // Clean up
    otpStore.delete(emailOrPhone);
    
    return NextResponse.json({
      success: true,
      message: '2FA has been reset successfully',
    });
  } catch (error: any) {
    console.error('Reset 2FA error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to reset 2FA' } },
      { status: 500 }
    );
  }
}
