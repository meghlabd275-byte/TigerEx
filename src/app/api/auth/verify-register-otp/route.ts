import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Verify Registration OTP - Production Implementation
 * Verifies OTP from database
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
        WHERE email = ? AND code = ? AND purpose = 'register' AND verified_at IS NULL
      `).get(emailOrPhone.toLowerCase(), code);
    } else {
      otpRecord = db.prepare(`
        SELECT * FROM otp_codes 
        WHERE phone = ? AND code = ? AND purpose = 'register' AND verified_at IS NULL
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
        { success: false, error: { code: 'OTP_EXPIRED', message: 'Verification code has expired. Please request a new one.' } },
        { status: 400 }
      );
    }
    
    // Check attempts
    if ((otpRecord as any).attempts >= (otpRecord as any).max_attempts) {
      return NextResponse.json(
        { success: false, error: { code: 'OTP_MAX_ATTEMPTS', message: 'Too many attempts. Please request a new code.' } },
        { status: 400 }
      );
    }
    
    // Verify code - update the record
    db.prepare(`
      UPDATE otp_codes 
      SET verified_at = datetime('now'), attempts = attempts + 1
      WHERE otp_id = ?
    `).run((otpRecord as any).otp_id);
    
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
