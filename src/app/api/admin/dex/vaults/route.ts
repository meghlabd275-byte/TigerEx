import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validateVaultInput } from '@/lib/dex/validation';
import { dexFailure } from '@/lib/dex/route-helpers';
import { harvestVault, listVaults, fundVaultRewards, vaultRewardBalance } from '@/lib/dex/vault-service';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap auto-compounding vault administration.
 *
 * Create a vault, pause or resume it, and record a harvest. Every mutation is
 * validated, written to `dex_vaults` and appended to the audit trail. The vault
 * holds real LP tokens, so it can only be created against a pool that exists.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ success: true, vaults: listVaults() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validateVaultInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const vault = validated.value;

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM dex_pools WHERE pool_id = ?').get(vault.poolId)) {
    return fail('UNKNOWN_POOL', 'the vault must target an existing pool', 404);
  }
  if (db.prepare('SELECT 1 FROM dex_vaults WHERE name = ?').get(vault.name)) {
    return fail('DUPLICATE_VAULT', 'a vault with this name already exists', 409);
  }

  const vaultId = generateId();
  db.prepare(
    `INSERT INTO dex_vaults (vault_id, name, kind, pool_id, staked_token, reward_token, performance_fee_bps, min_harvest, total_assets, total_supply, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(
    vaultId,
    vault.name,
    vault.kind,
    vault.poolId,
    vault.stakedToken,
    vault.rewardToken,
    vault.performanceFeeBps,
    vault.minHarvest,
    vault.status,
  );
  recordAdminAction(request, auth.admin, 'dex.vault.create', { type: 'dex_vault', id: vaultId, detail: vault });
  return NextResponse.json({ success: true, vaultId }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const db = getDb();
  const vaultId = String(body.vaultId ?? '');
  const existing = db.prepare('SELECT * FROM dex_vaults WHERE vault_id = ?').get(vaultId) as Record<string, unknown> | undefined;
  if (!existing) return fail('UNKNOWN_VAULT', 'vault does not exist', 404);

  const assignments: string[] = [];
  const params: unknown[] = [];
  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!['active', 'paused'].includes(status)) return fail('VALIDATION_FAILED', 'status must be one of active, paused');
    assignments.push('status = ?');
    params.push(status);
  }
  if (body.performanceFeeBps !== undefined) {
    const fee = Number(body.performanceFeeBps);
    if (!Number.isInteger(fee) || fee < 0 || fee >= 10_000) {
      return fail('VALIDATION_FAILED', 'performanceFeeBps must be an integer in [0, 10000)');
    }
    assignments.push('performance_fee_bps = ?');
    params.push(fee);
  }
  if (body.minHarvest !== undefined) {
    const min = Number(body.minHarvest);
    if (!Number.isFinite(min) || min < 0) return fail('VALIDATION_FAILED', 'minHarvest must be a non-negative number');
    assignments.push('min_harvest = ?');
    params.push(min);
  }
  if (assignments.length === 0) return fail('VALIDATION_FAILED', 'no updatable field was supplied');

  params.push(vaultId);
  db.prepare(`UPDATE dex_vaults SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE vault_id = ?`).run(...params);
  recordAdminAction(request, auth.admin, 'dex.vault.update', { type: 'dex_vault', id: vaultId, detail: body });
  return NextResponse.json({ success: true });
}

/**
 * Fund a vault's harvest account, or record a harvest.
 *
 * A harvest compounds a real, funded gain into the vault. The operator first
 * funds the harvest account; the service refuses a harvest larger than the
 * account holds, so the share price can never be lifted with minted value.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const vaultId = String(body.vaultId ?? '');
  if (String(body.action ?? '').toLowerCase() === 'fund-rewards') {
    const asset = String(body.asset ?? '').trim().toUpperCase();
    if (!vaultId) return fail('VALIDATION_FAILED', 'vaultId is required');
    if (!asset) return fail('VALIDATION_FAILED', 'asset is required');
    try {
      fundVaultRewards(vaultId, asset, Number(body.amount ?? 0));
    } catch (error) {
      const dexError = error as { code?: string; message?: string; status?: number };
      return fail(dexError.code ?? 'INVALID_AMOUNT', dexError.message ?? 'could not fund rewards', dexError.status ?? 400);
    }
    recordAdminAction(request, auth.admin, 'dex.vault.fund', { type: 'dex_vault_reward', id: vaultId, detail: { asset, amount: Number(body.amount ?? 0) } });
    return NextResponse.json({ success: true, vaultId, balance: vaultRewardBalance(vaultId, asset) }, { status: 201 });
  }

  try {
    const result = harvestVault(vaultId, Number(body.rewardAmount ?? 0), Number(body.assetsAdded ?? 0));
    recordAdminAction(request, auth.admin, 'dex.vault.harvest', { type: 'dex_vault', id: vaultId, detail: result });
    return NextResponse.json({ success: true, harvest: result });
  } catch (error) {
    return dexFailure(error);
  }
}
