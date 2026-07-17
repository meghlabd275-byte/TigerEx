import { NextRequest, NextResponse } from 'next/server';

const otpStore = new Map<string, { code: string; expires: number }>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, code, newPassword } = body;
    
    if (!emailOrPhone || !code || !newPassword) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'All fields are required' } },
        { status: 400 }
      );
    }
    
    // Verify password requirements
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' } },
        { status: 400 }
      );
    }
    
    const otpRecord = otpStore.get(emailOrPhone);
    
    if (!otpRecord || otpRecord.code !== 'VERIFIED') {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_VERIFIED', message: 'Please verify your identity first' } },
        { status: 400 }
      );
    }
    
    // In production, hash the password and update in database
    // For demo, just return success
    console.log(`Password reset for ${emailOrPhone}`);
    
    // Clean up
    otpStore.delete(emailOrPhone);
    
    return NextResponse.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error: any) {
    console.error('Password reset error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Password reset failed' } },
      { status: 500 }
    );
  }
}
