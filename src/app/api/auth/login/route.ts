import { NextRequest, NextResponse } from 'next/server';
import { getDb, verifyPassword, generateToken, generateId, hashPassword } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * Login API - Production Implementation
 * Authenticates user and creates session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credential, password, rememberMe } = body;
    
    if (!credential || !password) {
      return NextResponse.json(
        { success: false, message: 'Credential and password are required' },
        { status: 400 }
      );
    }
    
    const db = getDb();
    
    // Determine if input is email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(credential);
    
    // Find user
    let user = null;
    if (isEmail) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(credential.toLowerCase());
    } else {
      const normalizedPhone = credential.replace(/[^0-9+]/g, '');
      user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizedPhone);
    }
    
    if (!user) {
      // Log failed attempt
      const attemptId = generateId();
      db.prepare(`
        INSERT INTO login_attempts (attempt_id, email, phone, ip_address, success, failure_reason)
        VALUES (?, ?, ?, ?, 0, 'user_not_found')
      `).run(
        attemptId,
        isEmail ? credential.toLowerCase() : null,
        isEmail ? null : credential,
        request.headers.get('x-forwarded-for') || 'unknown'
      );
      
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }
    
    // Check if account is locked
    if (user.locked_until) {
      const lockTime = new Date(user.locked_until as string);
      if (lockTime > new Date()) {
        const remainingMinutes = Math.ceil((lockTime.getTime() - Date.now()) / 60000);
        return NextResponse.json({
          success: false,
          message: 'Account is locked',
          securityMessage: `Too many failed attempts. Try again in ${remainingMinutes} minutes.`,
        }, { status: 403 });
      }
    }
    
    // Verify password
    const isValidPassword = verifyPassword(password, user.password_hash as string);
    
    if (!isValidPassword) {
      // Increment failed attempts
      const newFailedAttempts = (user.failed_attempts || 0) + 1;
      let lockedUntil = null;
      
      if (newFailedAttempts >= 5) {
        lockedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 hours
      }
      
      db.prepare(`
        UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(newFailedAttempts, lockedUntil, user.user_id);
      
      // Log failed attempt
      const attemptId = generateId();
      db.prepare(`
        INSERT INTO login_attempts (attempt_id, user_id, email, phone, ip_address, success, failure_reason)
        VALUES (?, ?, ?, ?, ?, 0, 'invalid_password')
      `).run(
        attemptId,
        user.user_id,
        isEmail ? credential.toLowerCase() : null,
        isEmail ? null : credential,
        request.headers.get('x-forwarded-for') || 'unknown'
      );
      
      if (newFailedAttempts >= 5) {
        return NextResponse.json({
          success: false,
          message: 'Account locked due to too many failed attempts',
          securityMessage: 'Too many failed login attempts. Your account has been locked for 48 hours.',
        }, { status: 403 });
      }
      
      return NextResponse.json(
        { success: false, message: `Invalid credentials. ${5 - newFailedAttempts} attempts remaining.` },
        { status: 401 }
      );
    }
    
    // Reset failed attempts on successful login
    db.prepare(`
      UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(user.user_id);
    
    // Check if 2FA is enabled
    if (user.two_factor_enabled) {
      // Generate temp token for 2FA verification
      const tempToken = randomBytes(32).toString('hex');
      const tempExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      
      // Store temp token
      const sessionId = generateId();
      db.prepare(`
        INSERT INTO sessions (session_id, user_id, access_token, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        user.user_id,
        tempToken,
        tempExpiry,
        request.headers.get('x-forwarded-for') || 'unknown',
        request.headers.get('user-agent') || 'unknown'
      );
      
      return NextResponse.json({
        success: true,
        requires2FA: true,
        tempToken: tempToken,
        message: '2FA verification required',
      });
    }
    
    // Generate tokens
    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const tokenExpiry = rememberMe 
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()  // 30 days
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();     // 24 hours
    
    // Create session
    const sessionId = generateId();
    db.prepare(`
      INSERT INTO sessions (session_id, user_id, access_token, refresh_token, expires_at, ip_address, user_agent, trusted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      user.user_id,
      accessToken,
      refreshToken,
      tokenExpiry,
      request.headers.get('x-forwarded-for') || 'unknown',
      request.headers.get('user-agent') || 'unknown',
      rememberMe ? 1 : 0
    );
    
    // Log successful login
    const attemptId = generateId();
    db.prepare(`
      INSERT INTO login_attempts (attempt_id, user_id, email, phone, ip_address, success)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(
      attemptId,
      user.user_id,
      isEmail ? credential.toLowerCase() : null,
      isEmail ? null : credential,
      request.headers.get('x-forwarded-for') || 'unknown'
    );
    
    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        email: user.email,
        phone: user.phone,
        username: user.username,
        kycLevel: user.kyc_level,
        kycStatus: user.kyc_status,
        twoFactorEnabled: !!user.two_factor_enabled,
      },
    });
  } catch (error: any) {
    console.error('Login API error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
