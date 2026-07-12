import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Upload KYC document
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const formData = await request.formData();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const documentType = formData.get('documentType');
    const file = formData.get('file');

    if (!documentType || !file) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: documentType, file' },
        { status: 400 }
      );
    }

    // Convert form data to backend request
    const body = new FormData();
    body.append('documentType', documentType.toString());
    body.append('file', file as File);

    const response = await fetch(`${API_BASE_URL}/kyc/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body,
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to upload document' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('KYC documents API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
