import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailOrPhone } = body;
    
    if (!emailOrPhone) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Required' } }, { status: 400 });
    }
    
    // In production, mark account for deletion in database
    console.log(`Account deletion requested for ${emailOrPhone}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Account marked for deletion',
      deletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      canCancelUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed' } }, { status: 500 });
  }
}
