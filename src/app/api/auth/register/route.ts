import { NextRequest, NextResponse } from 'next/server';
import { getDb, hashPassword, generateId, generateToken } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * Register API - Production Implementation
 * Creates new user account
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, password, username, referralCode } = body;
    
    if (!emailOrPhone || !password) {
      return NextResponse.json(
        { success: false, message: 'Email/phone and password are required' },
        { status: 400 }
      );
    }
    
    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }
    
    const db = getDb();
    
    // Determine if input is email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(emailOrPhone);
    
    // Check if user already exists
    let existingUser = null;
    if (isEmail) {
      existingUser = db.prepare('SELECT user_id FROM users WHERE email = ?').get(emailOrPhone.toLowerCase());
    } else {
      const normalizedPhone = emailOrPhone.replace(/[^0-9+]/g, '');
      existingUser = db.prepare('SELECT user_id FROM users WHERE phone = ?').get(normalizedPhone);
    }
    
    if (existingUser) {
      return NextResponse.json(
        { success: false, message: 'User already exists' },
        { status: 400 }
      );
    }
    
    // Check if username is taken (if provided)
    if (username) {
      const existingUsername = db.prepare('SELECT user_id FROM users WHERE username = ?').get(username);
      if (existingUsername) {
        return NextResponse.json(
          { success: false, message: 'Username is already taken' },
          { status: 400 }
        );
      }
    }
    
    // Check if OTP was verified (verified_at is not null)
    let otpVerified = false;
    if (isEmail) {
      const otp = db.prepare(`
        SELECT otp_id FROM otp_codes 
        WHERE email = ? AND purpose = 'register' AND verified_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(emailOrPhone.toLowerCase());
      otpVerified = !!otp;
    } else {
      const otp = db.prepare(`
        SELECT otp_id FROM otp_codes 
        WHERE phone = ? AND purpose = 'register' AND verified_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(emailOrPhone);
      otpVerified = !!otp;
    }
    
    if (!otpVerified) {
      return NextResponse.json(
        { success: false, message: 'Please verify your email/phone first' },
        { status: 400 }
      );
    }
    
    // Hash password
    const passwordHash = hashPassword(password);
    
    // Create user
    const userId = generateId();
    const now = new Date().toISOString();
    
    if (isEmail) {
      db.prepare(`
        INSERT INTO users (user_id, email, password_hash, username, email_verified, created_at, updated_at, status)
        VALUES (?, ?, ?, ?, 1, ?, ?, 'active')
      `).run(
        userId,
        emailOrPhone.toLowerCase(),
        passwordHash,
        username || null,
        now,
        now
      );
    } else {
      const normalizedPhone = emailOrPhone.replace(/[^0-9+]/g, '');
      db.prepare(`
        INSERT INTO users (user_id, phone, password_hash, username, phone_verified, created_at, updated_at, status)
        VALUES (?, ?, ?, ?, 1, ?, ?, 'active')
      `).run(
        userId,
        normalizedPhone,
        passwordHash,
        username || null,
        now,
        now
      );
    }
    
    // Create default wallets
    const walletTypes = ['spot', 'funding', 'trading'];
    for (const walletType of walletTypes) {
      const walletId = generateId();
      db.prepare(`
        INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, status)
        VALUES (?, ?, ?, 'USDT', 'TRC20', 'active')
      `).run(walletId, userId, walletType);
      
      // Create initial balance
      const balanceId = generateId();
      db.prepare(`
        INSERT INTO balances (balance_id, wallet_id, currency, available, locked)
        VALUES (?, ?, 'USDT', 0, 0)
      `).run(balanceId, walletId);
    }
    
    // Process referral code if provided
    if (referralCode) {
      // In production, validate referral code and reward referrer
    }
    
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
      userId,
      accessToken,
      refreshToken,
      tokenExpiry,
      request.headers.get('x-forwarded-for') || 'unknown',
      request.headers.get('user-agent') || 'unknown'
    );
    
    return NextResponse.json({
      success: true,
      message: 'Registration successful',
      accessToken,
      refreshToken,
      user: {
        userId,
        email: isEmail ? emailOrPhone.toLowerCase() : null,
        phone: isEmail ? null : emailOrPhone,
        username,
        kycLevel: 'none',
        kycStatus: 'pending',
      },
    });
  } catch (error: any) {
    console.error('Registration API error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
