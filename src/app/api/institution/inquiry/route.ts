import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';

const INQUIRY_TYPES = new Set(['custody', 'prime', 'otc', 'api', 'other']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Record an institutional enquiry.
 *
 * Enquiries are persisted so the institutional desk has a real queue. The
 * submitter is not required to be signed in, so this endpoint is intentionally
 * unauthenticated but validates and bounds every field.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const companyName = String(body.companyName ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const phone = body.phone ? String(body.phone).trim() : null;
  const inquiryType = String(body.inquiryType ?? '').trim().toLowerCase();
  const message = body.message ? String(body.message).trim() : null;

  if (!companyName || companyName.length > 200) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_COMPANY', message: 'Company name is required' } },
      { status: 400 },
    );
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_EMAIL', message: 'A valid email is required' } },
      { status: 400 },
    );
  }
  if (!INQUIRY_TYPES.has(inquiryType)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_TYPE', message: 'Unknown inquiry type' } },
      { status: 400 },
    );
  }
  if (message && message.length > 5000) {
    return NextResponse.json(
      { success: false, error: { code: 'MESSAGE_TOO_LONG', message: 'Message is too long' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const inquiryId = generateId();
    db.prepare(
      `INSERT INTO institution_inquiries
         (inquiry_id, company_name, email, phone, inquiry_type, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(inquiryId, companyName, email, phone, inquiryType, message);

    return NextResponse.json(
      { success: true, data: { inquiryId, status: 'received' } },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Institution inquiry error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
