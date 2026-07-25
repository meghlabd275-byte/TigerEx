import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Verify Email - Production Implementation
 * Verifies email OTP from database
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, code } = body;
    
    if (!email || !code) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Email and code are required' } },
        { status: 400 }
      );
    }
    
    const db = getDb();
    
    // Find OTP record
    const otpRecord = db.prepare(`
      SELECT * FROM otp_codes 
      WHERE email = ? AND code = ? AND purpose = 'register' AND verified_at IS NULL
    `).get(email.toLowerCase(), code);
    
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CODE', message: 'Invalid verification code' } },
        { status: 400 }
      );
    }
    
    // Check if expired
    const expiresAt = new Date((otpRecord as any).expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json(
        { success: false, error: { code: 'OTP_EXPIRED', message: 'Verification code has expired' } },
        { status: 400 }
      );
    }
    
    // Mark as verified
    db.prepare(`
      UPDATE otp_codes 
      SET verified_at = datetime('now')
      WHERE otp_id = ?
    `).run((otpRecord as any).otp_id);
    
    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error: any) {
    console.error('Verify email error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
