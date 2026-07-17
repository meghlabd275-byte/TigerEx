import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { currentEmail, newEmail } = body;
    
    if (!currentEmail || !newEmail) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'All fields required' } }, { status: 400 });
    }
    
    // In production, update email in database
    console.log(`Email changed from ${currentEmail} to ${newEmail}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Email changed successfully',
      withdrawalDisabledUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed' } }, { status: 500 });
  }
}
