import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;
    
    // For demo, accept any 6-digit code
    if (code && code.length === 6) {
      return NextResponse.json({
        success: true,
        message: 'Email verified successfully',
      });
    }
    
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_CODE', message: 'Invalid verification code' } },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Verification failed' } },
      { status: 500 }
    );
  }
}
