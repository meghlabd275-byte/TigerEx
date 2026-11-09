import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { contribute, listProjects, projectDetail } from '@/lib/dex/launch-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/** List launch projects, or one project's detail with `?projectId=`. */
export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (projectId) return NextResponse.json({ success: true, project: projectDetail(projectId) }, { headers: NO_STORE });
    return NextResponse.json({ success: true, projects: listProjects() }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

/** Contribute to a launch project. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.launchpad.contribute', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');
  try {
    const result = contribute(auth.user.userId, String(body.projectId ?? ''), Number(body.amount), String(body.quoteAsset ?? 'RUSD'));
    return NextResponse.json({ success: true, contribution: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
