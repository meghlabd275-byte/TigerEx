import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Submit KYC document
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const documentType = formData.get('documentType');
    const file = formData.get('file');

    if (!documentType || !file) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: documentType, file' },
        { status: 400 }
      );
    }

    const uploadFormData = new FormData();
    uploadFormData.append('documentType', documentType.toString());
    uploadFormData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/kyc/document`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: uploadFormData,
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to submit KYC document' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('KYC document API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
