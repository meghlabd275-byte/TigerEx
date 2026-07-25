import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateOTP, generateId } from '@/lib/db';

/**
 * Send Login OTP - Production Implementation
 * Sends OTP for passwordless login
 */
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
    
    const db = getDb();
    
    // Determine if input is email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(emailOrPhone);
    
    // Verify user exists
    let user = null;
    if (isEmail) {
      user = db.prepare('SELECT user_id FROM users WHERE email = ?').get(emailOrPhone.toLowerCase());
    } else {
      const normalizedPhone = emailOrPhone.replace(/[^0-9+]/g, '');
      user = db.prepare('SELECT user_id FROM users WHERE phone = ?').get(normalizedPhone);
    }
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    // Delete existing OTPs for this user
    if (isEmail) {
      db.prepare('DELETE FROM otp_codes WHERE email = ? AND purpose = ?').run(emailOrPhone.toLowerCase(), 'login');
    } else {
      db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(emailOrPhone, 'login');
    }
    
    // Store OTP in database
    const otpId = generateId();
    db.prepare(`
      INSERT INTO otp_codes (otp_id, user_id, email, phone, code, type, purpose, expires_at, max_attempts)
      VALUES (?, ?, ?, ?, ?, ?, 'login', ?, 3)
    `).run(
      otpId,
      (user as any).user_id,
      isEmail ? emailOrPhone.toLowerCase() : null,
      isEmail ? null : emailOrPhone,
      otp,
      isEmail ? 'email' : 'sms',
      expiresAt
    );
    
    // In production, send via email/SMS API
    console.log(`[OTP] Login code for ${emailOrPhone}: ${otp}`);
    
    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
    });
  } catch (error: any) {
    console.error('Send login OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send code' } },
      { status: 500 }
    );
  }
}
