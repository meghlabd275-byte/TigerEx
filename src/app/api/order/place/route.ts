import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';

/**
 * Place Order - Production Implementation
 * Creates order in database
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const { symbol, side, type, quantity, price, stopPrice, timeInForce } = body;

    if (!symbol || !side || !type || !quantity) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: symbol, side, type, quantity' },
        { status: 400 }
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

    // Validate trading pair exists
    const pair = db.prepare(`
      SELECT * FROM trading_pairs WHERE symbol = ? AND status = 'active'
    `).get(symbol);

    if (!pair) {
      return NextResponse.json(
        { success: false, error: 'Invalid trading pair' },
        { status: 400 }
      );
    }

    // Create order
    const orderId = generateId();
    const orderPrice = price || null;
    const orderStatus = type === 'market' ? 'filled' : 'new';
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO orders (order_id, user_id, symbol, side, type, price, quantity, filled_quantity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      session.user_id,
      symbol,
      side,
      type,
      orderPrice,
      quantity,
      type === 'market' ? quantity : 0,
      orderStatus,
      now,
      now
    );

    return NextResponse.json({
      success: true,
      orderId,
      symbol,
      side,
      type,
      quantity,
      price: orderPrice,
      status: orderStatus,
      createdAt: now,
    });
  } catch (error: any) {
    console.error('Place order API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
