import { NextRequest, NextResponse } from 'next/server';
import { getDb, hashPassword } from '@/lib/db';

/**
 * Reset Password - Production Implementation
 * Verifies OTP and resets password
 */
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
    
    const db = getDb();
    
    // Determine if input is email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(emailOrPhone);
    
    // Find user
    let user = null;
    if (isEmail) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailOrPhone.toLowerCase());
    } else {
      const normalizedPhone = emailOrPhone.replace(/[^0-9+]/g, '');
      user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizedPhone);
    }
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }
    
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
    
    // Hash new password
    const passwordHash = hashPassword(newPassword);
    
    // Update password
    db.prepare(`
      UPDATE users 
      SET password_hash = ?, password_changed_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(passwordHash, (user as any).user_id);
    
    // Mark OTP as verified
    db.prepare(`
      UPDATE otp_codes 
      SET verified_at = datetime('now')
      WHERE otp_id = ?
    `).run((otpRecord as any).otp_id);
    
    // Invalidate all sessions
    db.prepare(`
      DELETE FROM sessions WHERE user_id = ?
    `).run((user as any).user_id);
    
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
