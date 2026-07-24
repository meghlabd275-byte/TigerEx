import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * Check Account API - Production Implementation
 * Proxies to backend auth service to check if user exists
 */
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
    
    // Proxy to backend auth service
    const response = await fetch(`${API_BASE_URL}/auth/check-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        emailOrPhone,
        type: type === 'phone' ? 'phone' : 'email'
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' } },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { success: false, error: data.error || { code: 'CHECK_FAILED', message: 'Failed to check account' } },
        { status: response.status }
      );
    }

    // Return account status from backend
    return NextResponse.json({
      success: true,
      exists: data.exists,
      email: data.email,
      phone: data.phone,
      emailVerified: data.emailVerified || false,
      phoneVerified: data.phoneVerified || false,
      twoFactorEnabled: data.twoFactorEnabled || false,
      lockedUntil: data.lockedUntil || null,
      failedAttempts: data.failedAttempts || 0,
    });
  } catch (error: any) {
    console.error('Check account error:', error);
    
    // Fallback: try to determine if it's an email or phone
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = emailRegex.test(body.emailOrPhone);
    
    // If backend is unavailable, we can't verify - return not found to redirect to signup
    // This is safe because the actual login/register will validate against the backend
    return NextResponse.json(
      { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service temporarily unavailable' } },
      { status: 503 }
    );
  }
}
