import { NextRequest, NextResponse } from 'next/server';

// Demo user storage
const users = new Map<string, any>();

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } },
        { status: 401 }
      );
    }
    
    const token = authHeader.substring(7);
    
    // For demo, decode the token to get user info
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        
        // Return demo user
        return NextResponse.json({
          id: 'user_' + Date.now(),
          email: payload.emailOrPhone?.includes('@') ? payload.emailOrPhone : 'user@tigerex.com',
          phone: payload.emailOrPhone?.includes('@') ? null : payload.emailOrPhone,
          username: 'DemoUser',
          kycLevel: 1,
          status: 'active',
          twoFactorEnabled: false,
          createdAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      // Invalid token
    }
    
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } },
      { status: 401 }
    );
  } catch (error: any) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
