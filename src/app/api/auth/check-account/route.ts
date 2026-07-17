import { NextRequest, NextResponse } from 'next/server';

// In-memory storage for demo (would be database in production)
const users = new Map<string, any>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone, type } = body;
    
    if (!emailOrPhone) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'Email or phone is required' } },
        { status: 400 }
      );
    }
    
    // Check if user exists in our demo storage
    const userKey = type === 'phone' ? `phone:${emailOrPhone}` : `email:${emailOrPhone.toLowerCase()}`;
    const existingUser = users.get(userKey);
    
    if (existingUser) {
      return NextResponse.json({
        success: true,
        exists: true,
        email: existingUser.email,
        phone: existingUser.phone,
        emailVerified: existingUser.emailVerified || false,
        phoneVerified: existingUser.phoneVerified || false,
        twoFactorEnabled: existingUser.twoFactorEnabled || false,
        lockedUntil: existingUser.lockedUntil || null,
        failedAttempts: existingUser.failedAttempts || 0,
      });
    }
    
    // User doesn't exist
    return NextResponse.json(
      { success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' } },
      { status: 404 }
    );
  } catch (error: any) {
    console.error('Check account error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
