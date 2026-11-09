import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get support tickets
export async function GET(request: NextRequest) {
  const API_BASE_URL = backendBaseUrl();
  if (!API_BASE_URL) {
    return NextResponse.json(
      { success: false, error: { code: 'BACKEND_UNAVAILABLE', message: 'The trading backend is not configured.' } },
      { status: 503 },
    );
  }
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '20';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    let url = `${API_BASE_URL}/support/tickets?page=${page}&limit=${limit}`;
    if (status) url += `&status=${status}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch tickets' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Support tickets API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// Create support ticket
export async function POST(request: NextRequest) {
  const API_BASE_URL = backendBaseUrl();
  if (!API_BASE_URL) {
    return NextResponse.json(
      { success: false, error: { code: 'BACKEND_UNAVAILABLE', message: 'The trading backend is not configured.' } },
      { status: 503 },
    );
  }
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const { subject, category, priority, message } = body;

    if (!subject || !message) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: subject, message' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/support/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        subject,
        category,
        priority,
        message,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to create ticket' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Support tickets API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
