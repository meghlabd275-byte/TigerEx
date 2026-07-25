import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * KYC Management API - Admin endpoints
 * Handles KYC verification requests and management
 */

// Get all KYC requests
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '20';
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    // In production, this would call the backend KYC service
    // For now, return mock data structure
    const kycRequests = [
      {
        id: 'kyc_001',
        userId: 'user_001',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        status: 'pending',
        submittedAt: Date.now() - 86400000,
        documents: {
          front: true,
          back: true,
          selfie: true
        }
      },
      {
        id: 'kyc_002',
        userId: 'user_002',
        email: 'user2@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        status: 'approved',
        submittedAt: Date.now() - 172800000,
        approvedAt: Date.now() - 86400000,
        documents: {
          front: true,
          back: true,
          selfie: true
        }
      }
    ];

    return NextResponse.json({
      success: true,
      data: kycRequests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: kycRequests.length
      }
    });
  } catch (error: any) {
    console.error('KYC list error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Update KYC status (approve/reject)
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { kycId, status, reason } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!kycId || !status) {
      return NextResponse.json(
        { success: false, error: 'KYC ID and status are required' },
        { status: 400 }
      );
    }

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status' },
        { status: 400 }
      );
    }

    // In production, this would call the backend KYC service
    return NextResponse.json({
      success: true,
      message: `KYC ${kycId} ${status} successfully`,
      updatedAt: Date.now()
    });
  } catch (error: any) {
    console.error('KYC update error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
