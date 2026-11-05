/**
 * Launchpool campaigns and stakes.
 *
 * A campaign is a `launchpad_projects` row the operator created; the reward
 * pool, stake token and APY are its own columns. A stake locks the staker's
 * tokens in the balance ledger, so the same funds cannot be spent while they
 * are committed, and the reward is projected by the shared launchpool split.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { lockAvailable, unlockAvailable, LedgerError } from '@/lib/db/ledger';
import { launchpoolReward } from '@/lib/earn/products';

export class LaunchpoolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface LaunchpoolCampaign {
  id: string;
  project_id: string;
  name: string;
  description: string;
  reward_token: string;
  stake_token: string;
  total_rewards: number;
  min_stake: number;
  apy: number;
  status: string;
  start_time: string;
  end_time: string;
  participants: number;
  total_staked: number;
}

export interface LaunchpoolStake {
  id: string;
  project_id: string;
  stake_amount: number;
  reward_amount: number;
  claimed: boolean;
  created_at: string;
}

function vestingField(vesting: unknown, key: string): unknown {
  if (vesting === null || vesting === undefined) return undefined;
  if (typeof vesting === 'object') return (vesting as Record<string, unknown>)[key];
  if (typeof vesting !== 'string') return undefined;
  try {
    const parsed = JSON.parse(vesting);
    if (parsed && typeof parsed === 'object') return (parsed as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
  return undefined;
}

function campaignStatus(rawStatus: string, startNs: number, endNs: number): string {
  const now = Date.now() * 1_000_000;
  if (rawStatus === 'cancelled') return 'cancelled';
  if (now < startNs) return 'upcoming';
  if (now > endNs) return 'completed';
  return 'active';
}

/** Live and upcoming campaigns with their real participation counts. */
export function listCampaigns(statusFilter?: string): LaunchpoolCampaign[] {
  const db = getDb();
  const projects = db
    .prepare("SELECT * FROM launchpad_projects WHERE status != 'cancelled' ORDER BY start_ns DESC LIMIT 500")
    .all() as Array<Record<string, unknown>>;

  const stats = db
    .prepare(
      `SELECT project_id, COUNT(*) AS participants, COALESCE(SUM(amount), 0) AS total_staked
         FROM launchpad_subscriptions GROUP BY project_id`,
    )
    .all() as Array<{ project_id: string; participants: number; total_staked: number }>;

  return projects
    .map((row) => {
      const projectId = String(row.project_id);
      const stat = stats.find((s) => s.project_id === projectId);
      const startNs = Number(row.start_ns);
      const endNs = Number(row.end_ns);
      const stakeToken = String(vestingField(row.vesting, 'stakeToken') ?? 'RUSD').toUpperCase();
      return {
        id: projectId,
        project_id: projectId,
        name: String(row.name),
        description: String(vestingField(row.vesting, 'description') ?? ''),
        reward_token: String(row.token_symbol),
        stake_token: stakeToken,
        total_rewards: Number(row.total_allocation) || 0,
        min_stake: Number(vestingField(row.vesting, 'minStake') ?? 0) || 0,
        apy: Number(vestingField(row.vesting, 'apy') ?? 0) || 0,
        status: campaignStatus(String(row.status), startNs, endNs),
        start_time: new Date(startNs / 1_000_000).toISOString(),
        end_time: new Date(endNs / 1_000_000).toISOString(),
        participants: stat ? Number(stat.participants) : 0,
        total_staked: stat ? Number(stat.total_staked) : 0,
      };
    })
    .filter((campaign) => (statusFilter ? campaign.status === statusFilter : true));
}

/** The caller's stakes, newest first, with the reward projected to date. */
export function userStakes(userId: string): LaunchpoolStake[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM launchpad_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 500')
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const projectId = String(row.project_id);
    const stake = Number(row.amount) || 0;
    const project = db
      .prepare('SELECT total_allocation, vesting FROM launchpad_projects WHERE project_id = ?')
      .get(projectId) as { total_allocation: number; vesting: unknown } | undefined;
    const total = db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM launchpad_subscriptions WHERE project_id = ?')
      .get(projectId) as { total: number } | undefined;
    const rewardPool = project ? Number(project.total_allocation) || 0 : 0;
    const totalStake = total ? Number(total.total) || 0 : 0;
    return {
      id: String(row.subscription_id),
      project_id: projectId,
      stake_amount: stake,
      reward_amount: launchpoolReward(stake, totalStake, rewardPool),
      claimed: String(row.status) === 'claimed',
      created_at: String(row.created_at),
    };
  });
}

/**
 * Stake into a campaign.
 *
 * The window must be open and the amount at least the campaign minimum; the
 * stake is locked in the ledger inside the same transaction that writes the
 * subscription, so the commitment and the locked balance cannot disagree.
 */
export function stakeInCampaign(userId: string, projectId: string, amount: number): LaunchpoolStake {
  const id = String(projectId ?? '').trim();
  if (!id) throw new LaunchpoolError('VALIDATION_FAILED', 'project_id is required');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new LaunchpoolError('VALIDATION_FAILED', 'amount must be a positive number');
  }

  const db = getDb();
  const project = db.prepare('SELECT * FROM launchpad_projects WHERE project_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!project) throw new LaunchpoolError('UNKNOWN_PROJECT', 'No such launchpool campaign', 404);

  const status = campaignStatus(String(project.status), Number(project.start_ns), Number(project.end_ns));
  if (status !== 'active') throw new LaunchpoolError('CAMPAIGN_NOT_ACTIVE', `This campaign is ${status}`, 409);

  const stakeToken = String(vestingField(project.vesting, 'stakeToken') ?? 'RUSD').toUpperCase();
  const minStake = Number(vestingField(project.vesting, 'minStake') ?? 0) || 0;
  if (amount < minStake) throw new LaunchpoolError('VALIDATION_FAILED', `Minimum stake is ${minStake} ${stakeToken}`);

  const existing = db
    .prepare('SELECT subscription_id FROM launchpad_subscriptions WHERE project_id = ? AND user_id = ?')
    .get(id, userId) as { subscription_id: string } | undefined;

  const subscriptionId = existing ? existing.subscription_id : generateId();
  try {
    db.transaction(() => {
      lockAvailable(userId, stakeToken, amount);
      if (existing) {
        db.prepare('UPDATE launchpad_subscriptions SET amount = amount + ? WHERE subscription_id = ?').run(
          amount,
          subscriptionId,
        );
      } else {
        db.prepare(
          `INSERT INTO launchpad_subscriptions (subscription_id, project_id, user_id, amount, status)
           VALUES (?, ?, ?, ?, 'committed')`,
        ).run(subscriptionId, id, userId, amount);
      }
      db.prepare("UPDATE launchpad_projects SET raised = raised + ? WHERE project_id = ?").run(amount, id);
    })();
  } catch (error) {
    if (error instanceof LedgerError) {
      if (error.code === 'INSUFFICIENT_BALANCE') {
        throw new LaunchpoolError('INSUFFICIENT_BALANCE', `Insufficient ${stakeToken} balance`, 400);
      }
      throw new LaunchpoolError(error.code, error.message, error.status);
    }
    throw error;
  }

  const row = db
    .prepare('SELECT * FROM launchpad_subscriptions WHERE subscription_id = ?')
    .get(subscriptionId) as Record<string, unknown>;
  const stake = Number(row.amount) || 0;
  const total = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM launchpad_subscriptions WHERE project_id = ?')
    .get(id) as { total: number } | undefined;
  const totalStake = total ? Number(total.total) || 0 : 0;
  return {
    id: String(row.subscription_id),
    project_id: String(row.project_id),
    stake_amount: stake,
    reward_amount: launchpoolReward(stake, totalStake, Number(project.total_allocation) || 0),
    claimed: false,
    created_at: String(row.created_at),
  };
}

/** Release a stake's locked balance back to the staker when the campaign ends. */
export function releaseStake(userId: string, subscriptionId: string): void {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.*, p.vesting, p.end_ns FROM launchpad_subscriptions s
        JOIN launchpad_projects p ON p.project_id = s.project_id
       WHERE s.subscription_id = ? AND s.user_id = ?`,
    )
    .get(subscriptionId, userId) as Record<string, unknown> | undefined;
  if (!row) throw new LaunchpoolError('UNKNOWN_STAKE', 'No such stake for this account', 404);
  if (String(row.status) === 'claimed') throw new LaunchpoolError('ALREADY_RELEASED', 'This stake was already released', 409);
  if (Date.now() * 1_000_000 < Number(row.end_ns)) {
    throw new LaunchpoolError('CAMPAIGN_ACTIVE', 'The campaign has not ended yet', 409);
  }

  const stakeToken = String(vestingField(row.vesting, 'stakeToken') ?? 'RUSD').toUpperCase();
  db.transaction(() => {
    unlockAvailable(userId, stakeToken, Number(row.amount) || 0);
    db.prepare("UPDATE launchpad_subscriptions SET status = 'claimed' WHERE subscription_id = ?").run(subscriptionId);
  })();
}
