import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;
    
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }
    
    if (!code || code.length !== 6) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CODE', message: 'Invalid 2FA code' } },
        { status: 400 }
      );
    }
    
    // In production, verify the code against the stored secret
    // For demo, accept any 6-digit code
    return NextResponse.json({
      success: true,
      message: '2FA disabled successfully',
    });
  } catch (error: any) {
    console.error('Disable 2FA error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to disable 2FA' } },
      { status: 500 }
    );
  }
}
