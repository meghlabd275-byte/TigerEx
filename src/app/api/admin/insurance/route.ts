import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, positive, NO_STORE } from '@/lib/api/route-guards';
import { insuranceFundStatus } from '@/lib/risk/engine';

/**
 * Insurance funds, one per contract.
 *
 * The fund balance is grown by fee accrual and by explicit top-ups; this route
 * lets an operator set the target, the fee share and the ADL threshold, and
 * record a manual contribution. It never fabricates a balance.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const rows = getDb()
    .prepare('SELECT * FROM insurance_funds ORDER BY contract')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      funds: rows.map((row) => {
        const status = insuranceFundStatus(
          Number(row.balance),
          Number(row.target_balance),
          Number(row.adl_threshold),
        );
        return {
          contract: row.contract,
          balance: row.balance,
          targetBalance: row.target_balance,
          feeShare: row.fee_share,
          adlEnabled: row.adl_enabled === 1,
          adlThreshold: row.adl_threshold,
          healthy: status.healthy,
          ratio: Number.isFinite(status.ratio) ? status.ratio : null,
          adlArmed: status.adlArmed,
          updatedAt: row.updated_at,
        };
      }),
    },
    { headers: NO_STORE },
  );
}

/**
 * Create or update a contract's insurance fund parameters.
 *
 * `contribution` adds to the balance; `balance` sets it outright. Supplying
 * both is refused because the two are different intents.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.insurance');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const contract = String(body.contract ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(contract)) {
    return fail('VALIDATION_FAILED', 'contract must be of the form BASE/QUOTE');
  }

  const hasBalance = body.balance !== undefined;
  const hasContribution = body.contribution !== undefined;
  if (hasBalance && hasContribution) {
    return fail('VALIDATION_FAILED', 'supply either balance or contribution, not both');
  }

  let balance: number | null = null;
  if (hasBalance) {
    balance = finite(body.balance);
    if (balance === null || balance < 0) return fail('VALIDATION_FAILED', 'balance must be a non-negative number');
  }

  let contribution: number | null = null;
  if (hasContribution) {
    contribution = positive(body.contribution);
    if (contribution === null) return fail('VALIDATION_FAILED', 'contribution must be a positive number');
  }

  const targetBalance = body.targetBalance === undefined ? null : finite(body.targetBalance);
  if (body.targetBalance !== undefined && (targetBalance === null || targetBalance < 0)) {
    return fail('VALIDATION_FAILED', 'targetBalance must be a non-negative number');
  }

  const feeShare = body.feeShare === undefined ? null : finite(body.feeShare);
  if (body.feeShare !== undefined && (feeShare === null || feeShare < 0 || feeShare > 1)) {
    return fail('VALIDATION_FAILED', 'feeShare must be a fraction in [0, 1]');
  }

  const adlThreshold = body.adlThreshold === undefined ? null : finite(body.adlThreshold);
  if (body.adlThreshold !== undefined && (adlThreshold === null || adlThreshold < 0)) {
    return fail('VALIDATION_FAILED', 'adlThreshold must be a non-negative number');
  }

  const adlEnabled = body.adlEnabled === undefined ? null : body.adlEnabled === true;

  const db = getDb();
  const existing = db.prepare('SELECT * FROM insurance_funds WHERE contract = ?').get(contract) as
    | Record<string, unknown>
    | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO insurance_funds (contract, balance, target_balance, fee_share, adl_enabled, adl_threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      contract,
      balance ?? contribution ?? 0,
      targetBalance ?? 0,
      feeShare ?? 0.1,
      adlEnabled ? 1 : 0,
      adlThreshold ?? 0,
    );
  } else {
    const nextBalance =
      balance !== null
        ? balance
        : contribution !== null
          ? Number(existing.balance) + contribution
          : Number(existing.balance);

    db.prepare(
      `UPDATE insurance_funds
          SET balance = ?, target_balance = ?, fee_share = ?, adl_enabled = ?, adl_threshold = ?,
              updated_at = datetime('now')
        WHERE contract = ?`,
    ).run(
      nextBalance,
      targetBalance ?? existing.target_balance,
      feeShare ?? existing.fee_share,
      adlEnabled === null ? existing.adl_enabled : adlEnabled ? 1 : 0,
      adlThreshold ?? existing.adl_threshold,
      contract,
    );
  }

  recordAdminAction(request, auth.admin, 'insurance.update', {
    type: 'insurance_fund',
    id: contract,
    detail: { balance, contribution, targetBalance, feeShare, adlThreshold, adlEnabled },
  });

  const row = db.prepare('SELECT * FROM insurance_funds WHERE contract = ?').get(contract) as Record<string, unknown>;
  return NextResponse.json(
    {
      success: true,
      fund: {
        contract: row.contract,
        balance: row.balance,
        targetBalance: row.target_balance,
        feeShare: row.fee_share,
        adlEnabled: row.adl_enabled === 1,
        adlThreshold: row.adl_threshold,
      },
    },
    { headers: NO_STORE },
  );
}
