import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Check Account API - Production Implementation
 * Checks if user exists in the database
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
    
    let user = null;
    
    if (isEmail) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailOrPhone.toLowerCase());
    } else {
      // Phone number - normalize
      const normalizedPhone = emailOrPhone.replace(/[^0-9+]/g, '');
      user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizedPhone);
    }
    
    if (!user) {
      return NextResponse.json({
        success: true,
        exists: false,
        email: isEmail ? emailOrPhone : null,
        phone: isEmail ? null : emailOrPhone,
        emailVerified: false,
        phoneVerified: false,
        twoFactorEnabled: false,
        lockedUntil: null,
        failedAttempts: 0,
      });
    }

    // Check if account is locked
    let lockedUntil = null;
    if (user.locked_until) {
      const lockTime = new Date(user.locked_until as string);
      if (lockTime > new Date()) {
        lockedUntil = user.locked_until;
      }
    }

    return NextResponse.json({
      success: true,
      exists: true,
      email: user.email,
      phone: user.phone,
      emailVerified: !!user.email_verified,
      phoneVerified: !!user.phone_verified,
      twoFactorEnabled: !!user.two_factor_enabled,
      lockedUntil,
      failedAttempts: user.failed_attempts || 0,
    });
  } catch (error: any) {
    console.error('Check account error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check account' } },
      { status: 500 }
    );
  }
}
