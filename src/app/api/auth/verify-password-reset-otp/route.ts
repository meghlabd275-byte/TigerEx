import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Verify Password Reset OTP - Production Implementation
 * Verifies OTP for password reset
 */
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
    
    const db = getDb();
    
    // Determine if input is email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(emailOrPhone);
    
    // Find OTP record
    let otpRecord = null;
    if (isEmail) {
      otpRecord = db.prepare(`
        SELECT * FROM otp_codes 
        WHERE email = ? AND code = ? AND purpose = 'password_reset' AND verified_at IS NULL
      `).get(emailOrPhone.toLowerCase(), code);
    } else {
      otpRecord = db.prepare(`
        SELECT * FROM otp_codes 
        WHERE phone = ? AND code = ? AND purpose = 'password_reset' AND verified_at IS NULL
      `).get(emailOrPhone, code);
    }
    
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_OTP', message: 'Invalid verification code' } },
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
    
    // Mark OTP as verified
    db.prepare(`
      UPDATE otp_codes 
      SET verified_at = datetime('now'), attempts = attempts + 1
      WHERE otp_id = ?
    `).run((otpRecord as any).otp_id);
    
    return NextResponse.json({
      success: true,
      message: 'Verification successful',
    });
  } catch (error: any) {
    console.error('Verify password reset OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
