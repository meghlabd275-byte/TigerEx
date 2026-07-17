import { NextRequest, NextResponse } from 'next/server';

// Generate a random secret for TOTP
function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 16; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }
    
    // Generate a secret for the user to set up 2FA
    const secret = generateSecret();
    const otpauthUrl = `otpauth://totp/TigerEx?secret=${secret}&issuer=TigerEx`;
    
    return NextResponse.json({
      success: true,
      secret,
      otpauthUrl,
      message: '2FA enabled. Please set up your authenticator app.',
    });
  } catch (error: any) {
    console.error('Enable 2FA error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to enable 2FA' } },
      { status: 500 }
    );
  }
}
