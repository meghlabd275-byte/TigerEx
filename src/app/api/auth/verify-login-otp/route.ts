import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * Verify Login OTP - Production Implementation
 * Verifies OTP and creates session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, code, trustedDevice } = body;
    
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
        WHERE email = ? AND code = ? AND purpose = 'login' AND verified_at IS NULL
      `).get(emailOrPhone.toLowerCase(), code);
    } else {
      otpRecord = db.prepare(`
        SELECT * FROM otp_codes 
        WHERE phone = ? AND code = ? AND purpose = 'login' AND verified_at IS NULL
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
    
    // Check attempts
    if ((otpRecord as any).attempts >= (otpRecord as any).max_attempts) {
      return NextResponse.json(
        { success: false, error: { code: 'OTP_MAX_ATTEMPTS', message: 'Too many attempts' } },
        { status: 400 }
      );
    }
    
    // Mark OTP as verified
    db.prepare(`
      UPDATE otp_codes 
      SET verified_at = datetime('now'), attempts = attempts + 1
      WHERE otp_id = ?
    `).run((otpRecord as any).otp_id);
    
    // Get user
    const userId = (otpRecord as any).user_id;
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }
    
    // Update last login
    db.prepare(`
      UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId);
    
    // Generate tokens
    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const tokenExpiry = trustedDevice 
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()  // 30 days
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();      // 24 hours
    
    // Create session
    const sessionId = generateId();
    db.prepare(`
      INSERT INTO sessions (session_id, user_id, access_token, refresh_token, expires_at, ip_address, user_agent, trusted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      userId,
      accessToken,
      refreshToken,
      tokenExpiry,
      request.headers.get('x-forwarded-for') || 'unknown',
      request.headers.get('user-agent') || 'unknown',
      trustedDevice ? 1 : 0
    );
    
    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: 86400,
      user: {
        userId: user.user_id,
        email: user.email,
        phone: user.phone,
        username: user.username,
        kycLevel: user.kyc_level,
        kycStatus: user.kyc_status,
      },
    });
  } catch (error: any) {
    console.error('Verify login OTP error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
