import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Get Wallet Balance - Production Implementation
 * Returns user wallet balances from database
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const db = getDb();
    
    // Find session by token
    const session = db.prepare(`
      SELECT user_id FROM sessions 
      WHERE access_token = ? AND expires_at > datetime('now')
    `).get(token) as { user_id: string } | undefined;
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Get user wallets
    const wallets = db.prepare(`
      SELECT * FROM wallets WHERE user_id = ?
    `).all(session.user_id);
    
    // Calculate total balance
    let totalUSDT = 0;
    const balances = (wallets as any[]).map(wallet => {
      // Convert all to USDT value (simplified)
      const value = parseFloat(wallet.balance) * (wallet.usd_price || 1);
      totalUSDT += value;
      return {
        coin: wallet.currency,
        free: wallet.available_balance,
        locked: wallet.locked_balance,
        usdValue: value,
      };
    });

    return NextResponse.json({
      success: true,
      balances,
      totalUSDT,
    });
  } catch (error: any) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
