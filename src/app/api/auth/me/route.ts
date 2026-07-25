import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Get Current User - Production Implementation
 * Returns user info based on session token
 */
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
    const db = getDb();
    
    // Find session by token
    const session = db.prepare(`
      SELECT s.*, u.email, u.phone, u.username, u.kyc_level, u.kyc_status, 
             u.two_factor_enabled, u.status as user_status, u.created_at, u.last_login_at
      FROM sessions s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.access_token = ? AND s.expires_at > datetime('now')
    `).get(token);
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    
    // Update last active
    db.prepare(`
      UPDATE sessions SET last_active_at = datetime('now') WHERE session_id = ?
    `).run((session as any).session_id);
    
    return NextResponse.json({
      success: true,
      user: {
        userId: (session as any).user_id,
        email: (session as any).email,
        phone: (session as any).phone,
        username: (session as any).username,
        kycLevel: (session as any).kyc_level,
        kycStatus: (session as any).kyc_status,
        twoFactorEnabled: !!(session as any).two_factor_enabled,
        status: (session as any).user_status,
        createdAt: (session as any).created_at,
        lastLoginAt: (session as any).last_login_at,
      },
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
