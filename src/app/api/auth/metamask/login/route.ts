import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;
    
    if (!address) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_ADDRESS', message: 'Wallet address required' } },
        { status: 400 }
      );
    }
    
    // In production, verify the address and create/link account
    const accessToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ address, type: 'metamask' })).toString('base64')}.demo`;
    const refreshToken = `refresh_mm_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: 'mm_' + address.substring(2, 10),
        address,
        username: 'MetaMaskUser',
        kycLevel: 0,
        status: 'active',
      },
    });
  } catch (error: any) {
    console.error('MetaMask login error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Login failed' } },
      { status: 500 }
    );
  }
}
