import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';
import {
  AmlError,
  fileReport,
  listCases,
  listReports,
  reportTypeForCase,
  scanForAmlCases,
  updateCase,
  type CasePriority,
  type CaseStatus,
} from '@/lib/compliance/aml';

/**
 * AML/CFT case management and regulatory reporting administration.
 *
 * GET lists cases (and, with `view=reports`, filed reports). POST runs an AML
 * scan on demand and returns the cases it opened or touched. PUT moves a case
 * through its lifecycle, or files a report (`action: 'file'`). Every mutation is
 * appended to the admin audit log.
 *
 * A case is opened only from a recorded venue signal; a report is filed once and
 * never rewritten.
 */
export const dynamic = 'force-dynamic';

const CASE_STATUSES: CaseStatus[] = ['open', 'investigating', 'escalated', 'closed'];
const CASE_PRIORITIES: CasePriority[] = ['low', 'normal', 'high', 'critical'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  if (searchParams.get('view') === 'reports') {
    return NextResponse.json(
      {
        success: true,
        reports: listReports({
          status: searchParams.get('status') ?? undefined,
          userId: searchParams.get('userId') ?? undefined,
          limit: Number(searchParams.get('limit') ?? 200),
        }),
      },
      { headers: NO_STORE },
    );
  }

  const status = searchParams.get('status') as CaseStatus | null;
  if (status && !CASE_STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${CASE_STATUSES.join(', ')}`);
  }
  return NextResponse.json(
    {
      success: true,
      cases: listCases({
        status: status ?? undefined,
        userId: searchParams.get('userId') ?? undefined,
        limit: Number(searchParams.get('limit') ?? 200),
      }),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.aml.scan');
  if (guard) return guard;

  const opened = scanForAmlCases();
  recordAdminAction(request, auth.admin, 'aml.scan', { detail: { touched: opened.length } });
  return NextResponse.json(
    { success: true, touched: opened.length, cases: opened },
    { headers: NO_STORE },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.aml.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const caseId = String(body.caseId ?? '').trim();
  if (!caseId) return fail('VALIDATION_FAILED', 'caseId is required');

  // Filing a report is a distinct action from updating the case.
  if (body.action === 'file') {
    const jurisdiction = String(body.jurisdiction ?? '').trim().toUpperCase();
    if (!jurisdiction) return fail('VALIDATION_FAILED', 'jurisdiction is required to file a report');
    try {
      const result = fileReport({
        caseId,
        jurisdiction,
        filedBy: auth.admin.email,
        reference: body.reference === undefined ? undefined : String(body.reference),
      });
      recordAdminAction(request, auth.admin, 'aml.report.file', {
        type: 'aml_case',
        id: caseId,
        detail: { reportId: result.reportId, created: result.created, jurisdiction },
      });
      return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof AmlError) return fail(error.code, error.message, error.status);
      throw error;
    }
  }

  const status = body.status === undefined ? undefined : String(body.status);
  if (status && !CASE_STATUSES.includes(status as CaseStatus)) {
    return fail('VALIDATION_FAILED', `status must be one of ${CASE_STATUSES.join(', ')}`);
  }
  const priority = body.priority === undefined ? undefined : String(body.priority);
  if (priority && !CASE_PRIORITIES.includes(priority as CasePriority)) {
    return fail('VALIDATION_FAILED', `priority must be one of ${CASE_PRIORITIES.join(', ')}`);
  }

  try {
    const updated = updateCase(caseId, {
      status: status as CaseStatus | undefined,
      priority: priority as CasePriority | undefined,
      assignedTo: body.assignedTo === undefined ? undefined : (body.assignedTo as string | null),
      resolution: body.resolution === undefined ? undefined : String(body.resolution),
    });
    recordAdminAction(request, auth.admin, 'aml.case.update', {
      type: 'aml_case',
      id: caseId,
      detail: { status: updated.status, priority: updated.priority, reportDue: reportTypeForCase(updated) },
    });
    return NextResponse.json({ success: true, case: updated }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AmlError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
