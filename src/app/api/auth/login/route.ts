import { NextRequest, NextResponse } from 'next/server';
import { getDb, verifyPassword, generateId } from '@/lib/db';
import { isSignInIpAllowed } from '@/lib/security/account';
import { createNotification } from '@/lib/notifications/inbox';
import { randomBytes } from 'crypto';
import { enforceRequestGuards } from '@/lib/api/route-guards';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';
import { checkOtp } from '@/lib/security/otp-verify-request';
import { createLoginChallenge } from '@/lib/security/login-challenge';

/**
 * Login API - Production Implementation
 * Authenticates user and creates session
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.login', 10, 60_000);
  if (guard) return guard;
  try {
    const body = await request.json();
    // `emailOrPhone` is the name the client sends; `credential` is accepted too
    // so existing API clients are not broken.
    const credential = body.credential ?? body.emailOrPhone;
    const { password, rememberMe, twoFactorCode } = body;
    
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
    
    // A suspended or otherwise inactive account may not open a session, even
    // with the correct password. The admin console deletes its sessions on
    // suspension, so this is the second half of that guarantee.
    if (user.status && user.status !== 'active') {
      db.prepare(`
        INSERT INTO login_attempts (attempt_id, user_id, email, phone, ip_address, success, failure_reason)
        VALUES (?, ?, ?, ?, ?, 0, 'account_inactive')
      `).run(
        generateId(),
        user.user_id,
        isEmail ? credential.toLowerCase() : null,
        isEmail ? null : credential,
        request.headers.get('x-forwarded-for') || 'unknown',
      );
      return NextResponse.json(
        { success: false, message: 'This account is not active. Contact support.' },
        { status: 403 },
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
    
    // Enforce the account's sign-in IP allowlist, when the account turned it on.
    // A password that is otherwise correct still cannot open a session from an
    // address the account did not authorise.
    const signInIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    if (!isSignInIpAllowed(user.user_id, signInIp)) {
      db.prepare(`
        INSERT INTO login_attempts (attempt_id, user_id, email, phone, ip_address, success, failure_reason)
        VALUES (?, ?, ?, ?, ?, 0, 'ip_not_allowlisted')
      `).run(
        generateId(),
        user.user_id,
        isEmail ? credential.toLowerCase() : null,
        isEmail ? null : credential,
        signInIp,
      );
      return NextResponse.json(
        { success: false, message: 'Sign-in is not permitted from this IP address' },
        { status: 403 },
      );
    }

    // Check if 2FA is enabled
    if (user.two_factor_enabled) {
      // A second factor supplied with the password completes sign-in here.
      // Otherwise a short-lived temporary session is issued for the client to
      // finish verification against.
      const submittedCode = String(twoFactorCode ?? '').trim();
      let secondFactorOk = false;
      if (submittedCode) {
        if (!user.two_factor_type || user.two_factor_type === 'totp') {
          if (user.two_factor_secret) {
            try {
              secondFactorOk = verifyTotp(decryptSecret(user.two_factor_secret), submittedCode);
            } catch {
              secondFactorOk = false;
            }
          }
        } else if (user.two_factor_type === 'email' || user.two_factor_type === 'sms') {
          secondFactorOk = checkOtp('login', credential, submittedCode).ok;
        }
      }

      if (!secondFactorOk) {
      // Hand back a single-use challenge token for the second step. It is
      // stored in `login_challenges`, never in `sessions`, so it cannot be
      // used as a bearer token before the second factor is verified.
      const challenge = createLoginChallenge(user.user_id);

      return NextResponse.json({
        success: true,
        requires2FA: true,
        tempToken: challenge.token,
        message: '2FA verification required',
      });
      }
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
    
    // Notify the account of the new sign-in when the user asked for alerts.
    // Best-effort: a notification failure must never block a valid sign-in.
    if (user.login_alerts_enabled) {
      try {
        createNotification({
          userId: user.user_id,
          type: 'security',
          title: 'New sign-in to your account',
          body: `A new sign-in was recorded from ${signInIp} at ${new Date().toISOString()}. If this was not you, change your password and revoke other sessions immediately.`,
          severity: 'warning',
        });
      } catch (error) {
        console.error('Login alert notification failed:', error);
      }
    }

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
