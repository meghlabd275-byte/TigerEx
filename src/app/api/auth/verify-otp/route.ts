import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * Verify OTP - Production Implementation
 * Verifies OTP for login or 2FA
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credential, otp, type, tempToken } = body;
    
    if (!credential || !otp) {
      return NextResponse.json(
        { success: false, message: 'Credential and OTP are required' },
        { status: 400 }
      );
    }
    
    const db = getDb();
    
    // Determine if input is email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(credential);
    
    // Find OTP record - try login purpose first, then 2fa
    let otpRecord = null;
    if (isEmail) {
      otpRecord = db.prepare(`
        SELECT * FROM otp_codes 
        WHERE email = ? AND code = ? AND (purpose = 'login' OR purpose = '2fa') AND verified_at IS NULL
      `).get(credential.toLowerCase(), otp);
    } else {
      otpRecord = db.prepare(`
        SELECT * FROM otp_codes 
        WHERE phone = ? AND code = ? AND (purpose = 'login' OR purpose = '2fa') AND verified_at IS NULL
      `).get(credential, otp);
    }
    
    if (!otpRecord) {
      return NextResponse.json(
        { success: false, message: 'Invalid verification code' },
        { status: 400 }
      );
    }
    
    // Check if expired
    const expiresAt = new Date((otpRecord as any).expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json(
        { success: false, message: 'Verification code has expired' },
        { status: 400 }
      );
    }
    
    // Check attempts
    if ((otpRecord as any).attempts >= (otpRecord as any).max_attempts) {
      return NextResponse.json(
        { success: false, message: 'Too many attempts. Please request a new code.' },
        { status: 400 }
      );
    }
    
    // Mark OTP as verified
    db.prepare(`
      UPDATE otp_codes 
      SET verified_at = datetime('now'), attempts = attempts + 1
      WHERE otp_id = ?
    `).run((otpRecord as any).otp_id);
    
    // If this was a 2FA verification from temp token, complete the login
    if (type === '2fa' && tempToken) {
      const session = db.prepare(`
        SELECT * FROM sessions WHERE access_token = ? AND expires_at > datetime('now')
      `).get(tempToken);
      
      if (!session) {
        return NextResponse.json(
          { success: false, message: 'Session expired' },
          { status: 400 }
        );
      }
      
      // Get user
      const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get((session as any).user_id);
      
      if (!user) {
        return NextResponse.json(
          { success: false, message: 'User not found' },
          { status: 404 }
        );
      }
      
      // Generate new access token
      const accessToken = randomBytes(32).toString('hex');
      const refreshToken = randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      // Update session with new token
      db.prepare(`
        UPDATE sessions 
        SET access_token = ?, refresh_token = ?, expires_at = ?
        WHERE session_id = ?
      `).run(accessToken, refreshToken, tokenExpiry, (session as any).session_id);
      
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
    }
    
    // For login OTP without 2FA
    if ((otpRecord as any).user_id) {
      const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get((otpRecord as any).user_id);
      
      if (user) {
        // Generate tokens
        const accessToken = randomBytes(32).toString('hex');
        const refreshToken = randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        
        // Create session
        const sessionId = generateId();
        db.prepare(`
          INSERT INTO sessions (session_id, user_id, access_token, refresh_token, expires_at, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionId,
          (otpRecord as any).user_id,
          accessToken,
          refreshToken,
          tokenExpiry,
          request.headers.get('x-forwarded-for') || 'unknown',
          request.headers.get('user-agent') || 'unknown'
        );
        
        return NextResponse.json({
          success: true,
          accessToken,
          refreshToken,
          user: {
            userId: (user as any).user_id,
            email: (user as any).email,
            phone: (user as any).phone,
            username: (user as any).username,
            kycLevel: (user as any).kyc_level,
            kycStatus: (user as any).kyc_status,
            twoFactorEnabled: !!(user as any).two_factor_enabled,
          },
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Verification successful',
    });
  } catch (error: any) {
    console.error('Verify OTP error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
