import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * KYC tier limits.
 *
 * Each verification level has a daily withdrawal cap and a monthly cap. The
 * limits are stored in `system_settings` under `kyc_limit_level_<n>` so the
 * withdrawal path reads one value rather than inferring a default. Level 0 is
 * the unverified tier and is the most restricted.
 */

const MAX_LEVEL = 3;

interface TierLimit {
  level: number;
  dailyWithdrawalUsd: number;
  monthlyWithdrawalUsd: number;
}

function defaultLimits(): TierLimit[] {
  return [
    { level: 0, dailyWithdrawalUsd: 10000, monthlyWithdrawalUsd: 20000 },
    { level: 1, dailyWithdrawalUsd: 100000, monthlyWithdrawalUsd: 500000 },
    { level: 2, dailyWithdrawalUsd: 1000000, monthlyWithdrawalUsd: 5000000 },
    { level: 3, dailyWithdrawalUsd: 10000000, monthlyWithdrawalUsd: 50000000 },
  ];
}

function readLimits(): TierLimit[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM system_settings WHERE key LIKE 'kyc_limit_level_%'")
    .all() as Array<{ key: string; value: string }>;

  const stored = new Map<string, string>();
  for (const row of rows) stored.set(row.key, row.value);

  return defaultLimits().map((tier) => {
    const raw = stored.get(`kyc_limit_level_${tier.level}`);
    if (!raw) return tier;
    try {
      const parsed = JSON.parse(raw) as Partial<TierLimit>;
      return {
        level: tier.level,
        dailyWithdrawalUsd: finite(parsed.dailyWithdrawalUsd) ?? tier.dailyWithdrawalUsd,
        monthlyWithdrawalUsd: finite(parsed.monthlyWithdrawalUsd) ?? tier.monthlyWithdrawalUsd,
      };
    } catch {
      return tier;
    }
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  return NextResponse.json({ success: true, levels: readLimits() }, { headers: NO_STORE });
}

/** Set the limits for one level. A higher level must never be more restricted. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.kyc-levels');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const level = Number(body.level);
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    return fail('VALIDATION_FAILED', `level must be an integer in [0, ${MAX_LEVEL}]`);
  }

  const daily = finite(body.dailyWithdrawalUsd);
  const monthly = finite(body.monthlyWithdrawalUsd);
  if (daily === null || daily < 0) return fail('VALIDATION_FAILED', 'dailyWithdrawalUsd must be a non-negative number');
  if (monthly === null || monthly < 0) return fail('VALIDATION_FAILED', 'monthlyWithdrawalUsd must be a non-negative number');
  if (monthly < daily) return fail('VALIDATION_FAILED', 'monthlyWithdrawalUsd must be at least dailyWithdrawalUsd');

  const limits = readLimits();
  const current = limits.find((tier) => tier.level === level);
  if (!current) return fail('UNKNOWN_LEVEL', `Level ${level} is not configured`, 404);

  const lower = limits.filter((tier) => tier.level < level);
  const higher = limits.filter((tier) => tier.level > level);
  for (const tier of lower) {
    if (daily < tier.dailyWithdrawalUsd || monthly < tier.monthlyWithdrawalUsd) {
      return fail('VALIDATION_FAILED', `Level ${level} cannot be more restricted than level ${tier.level}`);
    }
  }
  for (const tier of higher) {
    if (daily > tier.dailyWithdrawalUsd || monthly > tier.monthlyWithdrawalUsd) {
      return fail('VALIDATION_FAILED', `Level ${level} cannot be less restricted than level ${tier.level}`);
    }
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO system_settings (key, value, category, updated_by, updated_at)
     VALUES (?, ?, 'compliance', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(
    `kyc_limit_level_${level}`,
    JSON.stringify({ level, dailyWithdrawalUsd: daily, monthlyWithdrawalUsd: monthly }),
    auth.admin.email,
  );

  recordAdminAction(request, auth.admin, 'kyc.limits.update', {
    type: 'kyc_level',
    id: String(level),
    detail: { dailyWithdrawalUsd: daily, monthlyWithdrawalUsd: monthly },
  });

  return NextResponse.json({ success: true, level, dailyWithdrawalUsd: daily, monthlyWithdrawalUsd: monthly }, { headers: NO_STORE });
}
