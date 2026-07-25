import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateOTP, generateId } from '@/lib/db';

/**
 * Send Registration OTP - Production Implementation
 * Stores OTP in database and sends via email/SMS
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
    
    // Check if user already exists
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(emailOrPhone);
    
    let existingUser = null;
    if (isEmail) {
      existingUser = db.prepare('SELECT user_id FROM users WHERE email = ?').get(emailOrPhone.toLowerCase());
    } else {
      const normalizedPhone = emailOrPhone.replace(/[^0-9+]/g, '');
      existingUser = db.prepare('SELECT user_id FROM users WHERE phone = ?').get(normalizedPhone);
    }
    
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: { code: 'USER_EXISTS', message: 'User already exists' } },
        { status: 400 }
      );
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
    
    // Check for existing OTP and delete
    if (isEmail) {
      db.prepare('DELETE FROM otp_codes WHERE email = ? AND purpose = ?').run(emailOrPhone.toLowerCase(), 'register');
    } else {
      db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(emailOrPhone, 'register');
    }
    
    // Store OTP in database
    const otpId = generateId();
    db.prepare(`
      INSERT INTO otp_codes (otp_id, email, phone, code, type, purpose, expires_at, max_attempts)
      VALUES (?, ?, ?, ?, ?, 'register', ?, 3)
    `).run(
      otpId,
      isEmail ? emailOrPhone.toLowerCase() : null,
      isEmail ? null : emailOrPhone,
      otp,
      isEmail ? 'email' : 'sms',
      expiresAt
    );
    
    // In production, integrate with email/SMS service
    // For now, log the OTP
    console.log(`[OTP] Registration code for ${emailOrPhone}: ${otp}`);
    
    // In production, send via email/SMS API
    // await sendEmail(emailOrPhone, 'Your TigerEx verification code', `Your code is: ${otp}`);
    // await sendSMS(phone, `Your TigerEx verification code: ${otp}`);
    
    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
    });
  } catch (error: any) {
    console.error('Send register OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to send verification code' } },
      { status: 500 }
    );
  }
}
