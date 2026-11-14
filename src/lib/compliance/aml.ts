/**
 * AML/CFT case management and regulatory reporting.
 *
 * A venue's anti-money-laundering obligation is not a single check; it is a
 * pipeline: signals are detected, a signal that warrants investigation becomes a
 * case, an analyst works the case, and a case that meets a threshold is filed
 * with the regulator as a suspicious-activity report (SAR/STR) or a currency
 * transaction report (CTR). This module implements that pipeline over the
 * venue's own data — no external provider is consulted.
 *
 * Signals are derived from tables the venue already keeps:
 *  - open market-integrity `surveillance_alerts` (wash trading, spoofing, ...);
 *  - a structuring heuristic over the user's own withdrawal history (several
 *    transfers just under a reporting threshold inside a short window);
 *  - a large single transfer at or above the CTR threshold.
 *
 * Everything fails closed. A case is opened only from a recorded signal, a
 * report is built only from a real case, and a report is filed once and never
 * rewritten — the payload is hash-committed so a filed report is tamper-evident.
 */

import { createHash } from 'node:crypto';
import { getDb, generateId } from '@/lib/db';

export class AmlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type CaseStatus = 'open' | 'investigating' | 'escalated' | 'closed';
export type CasePriority = 'low' | 'normal' | 'high' | 'critical';
export type ReportType = 'SAR' | 'STR' | 'CTR' | 'LARGE_TXN';

export interface AmlSignal {
  source: string;
  kind: string;
  score: number;
  detail: Record<string, unknown>;
  reference?: string;
}

export interface AmlCase {
  caseId: string;
  userId: string;
  status: CaseStatus;
  priority: CasePriority;
  source: string;
  score: number;
  summary: string;
  signals: AmlSignal[];
  assignedTo: string | null;
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  resolution: string | null;
}

// --- Thresholds (named so a test can pin the exact behaviour) --------------
/** A currency-transaction report is filed at or above this USD value. */
export const CTR_THRESHOLD_USD = 10_000;
/** Several transfers just under the CTR threshold within this window is
 *  structuring ("smurfing"). */
export const STRUCTURING_WINDOW_HOURS = 24;
/** A transfer between this fraction of the CTR threshold and the threshold
 *  itself is "just under" it. */
export const STRUCTURING_BAND = 0.9;
/** How many just-under transfers inside the window raise a structuring signal. */
export const STRUCTURING_MIN_COUNT = 3;
/** A single-case score at or above this is filed as suspicious rather than
 *  merely logged. */
export const SAR_SCORE_THRESHOLD = 0.6;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function priorityForScore(score: number): CasePriority {
  if (score >= 0.85) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.3) return 'normal';
  return 'low';
}

/**
 * Open (or return the existing) case for a user and signal.
 *
 * The case key is `(user, source, summary)`, so a periodic re-scan that finds
 * the same signal again returns the open case instead of stacking duplicates.
 * If a matching case was already closed, a fresh one is opened so a recurrence
 * is not silently ignored.
 */
export function openCase(input: {
  userId: string;
  source: string;
  summary: string;
  signals: AmlSignal[];
  openedBy?: string | null;
}): AmlCase {
  const db = getDb();
  const score = input.signals.reduce((max, signal) => Math.max(max, signal.score), 0);
  const existing = db
    .prepare(
      `SELECT case_id FROM aml_cases
        WHERE user_id = ? AND source = ? AND summary = ? AND status != 'closed'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(input.userId, input.source, input.summary) as { case_id: string } | undefined;

  if (existing) {
    // Append the new signals to the open case so nothing is lost.
    const row = db.prepare('SELECT signals, score FROM aml_cases WHERE case_id = ?').get(existing.case_id) as {
      signals: string;
      score: number;
    };
    const merged: AmlSignal[] = [...(JSON.parse(row.signals) as AmlSignal[]), ...input.signals];
    db.prepare(
      `UPDATE aml_cases SET signals = ?, score = ?, updated_at = datetime('now') WHERE case_id = ?`,
    ).run(JSON.stringify(merged), Math.max(score, Number(row.score) || 0), existing.case_id);
    return getCase(existing.case_id)!;
  }

  const caseId = generateId();
  db.prepare(
    `INSERT INTO aml_cases (case_id, user_id, status, priority, source, score, summary, signals, opened_by)
     VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
  ).run(
    caseId,
    input.userId,
    priorityForScore(score),
    input.source,
    score,
    input.summary,
    JSON.stringify(input.signals),
    input.openedBy ?? null,
  );
  return getCase(caseId)!;
}

function rowToCase(row: Record<string, unknown>): AmlCase {
  return {
    caseId: String(row.case_id),
    userId: String(row.user_id),
    status: row.status as CaseStatus,
    priority: row.priority as CasePriority,
    source: String(row.source),
    score: Number(row.score) || 0,
    summary: String(row.summary),
    signals: JSON.parse(String(row.signals ?? '[]')) as AmlSignal[],
    assignedTo: (row.assigned_to as string) ?? null,
    openedBy: (row.opened_by as string) ?? null,
    openedAt: String(row.opened_at),
    closedAt: (row.closed_at as string) ?? null,
    resolution: (row.resolution as string) ?? null,
  };
}

export function getCase(caseId: string): AmlCase | null {
  const row = getDb().prepare('SELECT * FROM aml_cases WHERE case_id = ?').get(caseId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToCase(row) : null;
}

export function listCases(filter: { status?: CaseStatus; userId?: string; limit?: number } = {}): AmlCase[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter.userId) {
    clauses.push('user_id = ?');
    params.push(filter.userId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = getDb()
    .prepare(`SELECT * FROM aml_cases${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToCase);
}

/**
 * Move a case to a new status.
 *
 * Closing a case requires a resolution, because the disposition is the record a
 * regulator reads. Reopening a closed case is refused — a recurrence opens a new
 * case instead, so the history stays linear.
 */
export function updateCase(
  caseId: string,
  input: { status?: CaseStatus; priority?: CasePriority; assignedTo?: string | null; resolution?: string },
): AmlCase {
  const current = getCase(caseId);
  if (!current) throw new AmlError('CASE_NOT_FOUND', 'No such case', 404);
  if (current.status === 'closed' && input.status && input.status !== 'closed') {
    throw new AmlError('CASE_CLOSED', 'A closed case cannot be reopened; open a new case for a recurrence', 409);
  }
  if (input.status === 'closed' && !(input.resolution ?? current.resolution)) {
    throw new AmlError('RESOLUTION_REQUIRED', 'Closing a case requires a resolution');
  }
  const next: CaseStatus = input.status ?? current.status;
  const priority: CasePriority = input.priority ?? current.priority;
  const assignedTo = input.assignedTo === undefined ? current.assignedTo : input.assignedTo;
  const resolution = input.resolution ?? current.resolution;
  const closed = next === 'closed';
  getDb()
    .prepare(
      `UPDATE aml_cases
          SET status = ?, priority = ?, assigned_to = ?, resolution = ?,
              closed_at = CASE WHEN ? THEN datetime('now') ELSE closed_at END,
              updated_at = datetime('now')
        WHERE case_id = ?`,
    )
    .run(next, priority, assignedTo, resolution, closed ? 1 : 0, caseId);
  return getCase(caseId)!;
}

/** The report type a case qualifies for, or null when none is due. */
export function reportTypeForCase(caseItem: AmlCase): ReportType | null {
  if (caseItem.score >= SAR_SCORE_THRESHOLD) return 'SAR';
  if (caseItem.signals.some((signal) => signal.kind === 'large_transaction')) return 'CTR';
  return null;
}

export interface ReportPayload {
  reportType: ReportType;
  jurisdiction: string;
  generatedAt: string;
  subject: { userId: string; caseId: string; source: string; score: number; priority: CasePriority };
  narrative: string;
  signals: AmlSignal[];
}

/**
 * Build the report payload for a case.
 *
 * The payload is the full, self-contained record a regulator receives: the
 * subject, the narrative and the underlying signals. It is deterministic apart
 * from the generation timestamp, so the same case yields the same fields.
 */
export function buildReportPayload(caseItem: AmlCase, jurisdiction: string): ReportPayload {
  const type = reportTypeForCase(caseItem);
  if (!type) throw new AmlError('NO_REPORT_DUE', 'This case does not meet a reporting threshold');
  const narrative =
    type === 'SAR'
      ? `Suspicious activity detected for user ${caseItem.userId}: ${caseItem.summary}. ` +
        `Case score ${caseItem.score.toFixed(2)} (${caseItem.priority}).`
      : `Reportable transaction for user ${caseItem.userId}: ${caseItem.summary}.`;
  return {
    reportType: type,
    jurisdiction,
    generatedAt: new Date().toISOString(),
    subject: {
      userId: caseItem.userId,
      caseId: caseItem.caseId,
      source: caseItem.source,
      score: caseItem.score,
      priority: caseItem.priority,
    },
    narrative,
    signals: caseItem.signals,
  };
}

/**
 * File a report for a case.
 *
 * A report is filed once. If a filed report already exists for the case it is
 * returned rather than re-filed, so the append-only record stays single.
 */
export function fileReport(input: {
  caseId: string;
  jurisdiction: string;
  filedBy: string;
  reference?: string;
}): { reportId: string; payloadHash: string; created: boolean } {
  const caseItem = getCase(input.caseId);
  if (!caseItem) throw new AmlError('CASE_NOT_FOUND', 'No such case', 404);
  const db = getDb();
  const existing = db
    .prepare("SELECT report_id, payload_hash FROM regulatory_reports WHERE case_id = ? AND status = 'filed' LIMIT 1")
    .get(input.caseId) as { report_id: string; payload_hash: string } | undefined;
  if (existing) return { reportId: existing.report_id, payloadHash: existing.payload_hash, created: false };

  const payload = buildReportPayload(caseItem, input.jurisdiction);
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const reportId = generateId();
  db.prepare(
    `INSERT INTO regulatory_reports
       (report_id, case_id, user_id, report_type, jurisdiction, status, reference, payload, payload_hash, filed_by, filed_at)
     VALUES (?, ?, ?, ?, ?, 'filed', ?, ?, ?, ?, datetime('now'))`,
  ).run(
    reportId,
    input.caseId,
    caseItem.userId,
    payload.reportType,
    input.jurisdiction,
    input.reference ?? null,
    JSON.stringify(payload),
    payloadHash,
    input.filedBy,
  );
  return { reportId, payloadHash, created: true };
}

export function listReports(filter: { status?: string; userId?: string; limit?: number } = {}): Array<Record<string, unknown>> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter.userId) {
    clauses.push('user_id = ?');
    params.push(filter.userId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT report_id, case_id, user_id, report_type, jurisdiction, status, reference, amount_usd,
              payload_hash, filed_by, filed_at, created_at
         FROM regulatory_reports${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    reportId: row.report_id,
    caseId: row.case_id,
    userId: row.user_id,
    reportType: row.report_type,
    jurisdiction: row.jurisdiction,
    status: row.status,
    reference: row.reference,
    amountUsd: row.amount_usd === null || row.amount_usd === undefined ? null : Number(row.amount_usd),
    payloadHash: row.payload_hash,
    filedBy: row.filed_by,
    filedAt: row.filed_at,
    createdAt: row.created_at,
  }));
}

/**
 * The structuring signal for a user, or null.
 *
 * A structuring pattern is several withdrawals inside a short window whose USD
 * value sits just under the CTR threshold — each individually below the
 * reporting line, but together clearly designed to avoid it. The value is taken
 * from the recorded `amount_usd`, so it reflects what was actually requested.
 */
export function structuringSignal(userId: string, now = new Date()): AmlSignal | null {
  const since = new Date(now.getTime() - STRUCTURING_WINDOW_HOURS * 3600_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT amount_usd FROM withdrawals
        WHERE user_id = ? AND amount_usd IS NOT NULL
          AND datetime(created_at) >= datetime(?)
          AND amount_usd >= ? AND amount_usd < ?`,
    )
    .all(userId, since, CTR_THRESHOLD_USD * STRUCTURING_BAND, CTR_THRESHOLD_USD) as Array<{ amount_usd: number }>;
  if (rows.length < STRUCTURING_MIN_COUNT) return null;
  return {
    source: 'withdrawal',
    kind: 'structuring',
    score: Math.min(0.95, 0.5 + rows.length * 0.05),
    detail: {
      count: rows.length,
      thresholdUsd: CTR_THRESHOLD_USD,
      windowHours: STRUCTURING_WINDOW_HOURS,
      totalUsd: rows.reduce((sum, row) => sum + row.amount_usd, 0),
    },
  };
}

/**
 * Scan the venue for reportable activity and open cases for it.
 *
 * Returns the cases opened or touched. Every signal comes from a recorded row;
 * nothing is estimated. Called from the scheduler cycle and on demand.
 */
export function scanForAmlCases(now = new Date()): AmlCase[] {
  const db = getDb();
  const touched: AmlCase[] = [];

  // 1. Open market-integrity alerts become cases, grouped per user.
  const alerts = db
    .prepare(
      `SELECT alert_id, kind, symbol, user_id, score, detail
         FROM surveillance_alerts
        WHERE status = 'open'`,
    )
    .all() as Array<Record<string, unknown>>;
  const byUser = new Map<string, AmlSignal[]>();
  for (const alert of alerts) {
    const userId = String(alert.user_id);
    const signal: AmlSignal = {
      source: 'surveillance',
      kind: String(alert.kind),
      score: Number(alert.score) || 0,
      detail: { alertId: alert.alert_id, symbol: alert.symbol, ...(JSON.parse(String(alert.detail ?? '{}')) as object) },
      reference: String(alert.alert_id),
    };
    byUser.set(userId, [...(byUser.get(userId) ?? []), signal]);
  }
  for (const [userId, signals] of byUser) {
    touched.push(
      openCase({
        userId,
        source: 'surveillance',
        summary: `Market-integrity signals: ${[...new Set(signals.map((s) => s.kind))].sort().join(', ')}`,
        signals,
        openedBy: null,
      }),
    );
  }

  // 2. A large withdrawal at or above the CTR threshold, and 3. structuring.
  const windowStart = new Date(now.getTime() - STRUCTURING_WINDOW_HOURS * 3600_000).toISOString();
  const users = db
    .prepare(
      `SELECT DISTINCT user_id FROM withdrawals
        WHERE amount_usd IS NOT NULL AND datetime(created_at) >= datetime(?)`,
    )
    .all(windowStart) as Array<{ user_id: string }>;
  for (const { user_id: userId } of users) {
    const large = db
      .prepare(
        `SELECT withdrawal_id, currency, amount_usd FROM withdrawals
          WHERE user_id = ? AND amount_usd >= ? AND datetime(created_at) >= datetime(?)
          ORDER BY amount_usd DESC LIMIT 1`,
      )
      .get(userId, CTR_THRESHOLD_USD, windowStart) as
      | { withdrawal_id: string; currency: string; amount_usd: number }
      | undefined;
    if (large) {
      touched.push(
        openCase({
          userId,
          source: 'withdrawal',
          summary: `Large withdrawal at or above ${CTR_THRESHOLD_USD} USD`,
          signals: [
            {
              source: 'withdrawal',
              kind: 'large_transaction',
              score: 0.7,
              detail: { withdrawalId: large.withdrawal_id, asset: large.currency, amountUsd: large.amount_usd },
              reference: large.withdrawal_id,
            },
          ],
          openedBy: null,
        }),
      );
    }
    const structuring = structuringSignal(userId, now);
    if (structuring) {
      touched.push(
        openCase({
          userId,
          source: 'withdrawal',
          summary: `Possible structuring: ${(structuring.detail.count as number)} transfers just under the CTR threshold`,
          signals: [structuring],
          openedBy: null,
        }),
      );
    }
  }

  return touched;
}
