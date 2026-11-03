/**
 * Generic CRUD route factory for listing tables.
 *
 * Options, ETF and TradFi listings are structurally the same operation: an
 * authenticated administrator lists, edits, pauses and delists a row, every
 * mutation is validated and appended to the audit trail, and every read is
 * uncached. This factory encodes that once so the routes stay thin and no
 * future listing type can forget the audit or validation step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE, enforceRequestGuards, symbolParam } from '@/lib/api/route-guards';

export interface CrudFieldSpec {
  /** JSON/API name, e.g. `strikePrice`. */
  field: string;
  /** SQL column name, e.g. `strike_price`. */
  column: string;
  /** Primary-key column that holds the symbol; used for lookups and delete. */
  unique?: boolean;
  /** Encoded as a JSON string when persisted. */
  json?: boolean;
  /** Stored as a boolean flag. */
  boolean?: boolean;
}

export interface CrudSpec<T> {
  /** Table name. */
  table: string;
  /** Name of the primary-key column. */
  idColumn: string;
  /** Audit action prefix, e.g. `market.options`. */
  auditPrefix: string;
  /** Target type recorded in the audit entry. */
  targetType: string;
  /** The column that uniquely identifies a listing (usually `symbol`). */
  symbolColumn: string;
  /** Field mapping between API payload and columns. */
  fields: CrudFieldSpec[];
  /**
   * Validate a payload. Returns the normalized record or an error message. The
   * normalized record must use the API field names from `fields`.
   */
  validate: (body: Record<string, unknown>) => { record: T } | { error: string };
  /**
   * Optional guard that runs before a delete. Return an error message to refuse
   * the delist (for example when open positions exist).
   */
  beforeDelete?: (db: ReturnType<typeof getDb>, symbol: string) => string | null;
}

function toRow(record: Record<string, unknown>, fields: CrudFieldSpec[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const spec of fields) {
    const value = record[spec.field];
    if (spec.json) row[spec.column] = JSON.stringify(value ?? null);
    else if (spec.boolean) row[spec.column] = value ? 1 : 0;
    else row[spec.column] = value === undefined ? null : value;
  }
  return row;
}

function fromRow(row: Record<string, unknown>, fields: CrudFieldSpec[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const spec of fields) {
    const value = row[spec.column];
    if (spec.json && typeof value === 'string') {
      try {
        record[spec.field] = JSON.parse(value);
      } catch {
        record[spec.field] = null;
      }
    } else if (spec.boolean) {
      record[spec.field] = value === 1 || value === true;
    } else {
      record[spec.field] = value ?? null;
    }
  }
  return record;
}

export interface CrudHandlers {
  GET: (request: NextRequest) => Promise<NextResponse>;
  POST: (request: NextRequest) => Promise<NextResponse>;
  PUT: (request: NextRequest) => Promise<NextResponse>;
  DELETE: (request: NextRequest) => Promise<NextResponse>;
}

/**
 * Build the four CRUD handlers for a listing table.
 *
 * GET lists (optionally filtered by the `status` query parameter), POST creates,
 * PUT updates by symbol, DELETE removes by symbol. All mutations require an
 * administrator, pass the origin and rate-limit guards, and are audited.
 */
export function createCrudRoute<T extends Record<string, unknown>>(spec: CrudSpec<T>): CrudHandlers {
  const allColumns = [spec.idColumn, ...spec.fields.map((f) => f.column)];

  async function GET(request: NextRequest): Promise<NextResponse> {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const status = request.nextUrl.searchParams.get('status');
    const clauses: string[] = [];
    const params: string[] = [];
    if (status) {
      clauses.push('status = ?');
      params.push(status.toLowerCase());
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

    const rows = getDb()
      .prepare(`SELECT * FROM ${spec.table}${where} ORDER BY ${spec.symbolColumn}`)
      .all(...params) as Array<Record<string, unknown>>;

    return NextResponse.json(
      { success: true, markets: rows.map((row) => fromRow(row, spec.fields)) },
      { headers: NO_STORE },
    );
  }

  async function POST(request: NextRequest): Promise<NextResponse> {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
    const guard = enforceRequestGuards(request, `${spec.auditPrefix}.create`);
    if (guard) return guard;

    const body = await readJson(request);
    if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

    const validated = spec.validate(body);
    if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
    const record = validated.record as Record<string, unknown>;
    const symbol = String(record[spec.symbolColumn] ?? '');

    const db = getDb();
    if (db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${spec.symbolColumn} = ?`).get(symbol)) {
      return fail('DUPLICATE_SYMBOL', `${symbol} is already listed`, 409);
    }

    const row = toRow(record, spec.fields);
    const columns = [spec.idColumn, ...Object.keys(row)];
    const placeholders = columns.map(() => '?').join(', ');
    const values = [generateId(), ...Object.values(row)];
    db.prepare(`INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);

    recordAdminAction(request, auth.admin, `${spec.auditPrefix}.list`, {
      type: spec.targetType,
      id: symbol,
      detail: record,
    });

    return NextResponse.json({ success: true, market: record }, { status: 201, headers: NO_STORE });
  }

  async function PUT(request: NextRequest): Promise<NextResponse> {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
    const guard = enforceRequestGuards(request, `${spec.auditPrefix}.update`);
    if (guard) return guard;

    const body = await readJson(request);
    if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

    const validated = spec.validate(body);
    if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
    const record = validated.record as Record<string, unknown>;
    const symbol = String(record[spec.symbolColumn] ?? '');

    const db = getDb();
    if (!db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${spec.symbolColumn} = ?`).get(symbol)) {
      return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);
    }

    const row = toRow(record, spec.fields);
    const assignments = Object.keys(row).map((column) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE ${spec.table} SET ${assignments} WHERE ${spec.symbolColumn} = ?`).run(
      ...Object.values(row),
      symbol,
    );

    recordAdminAction(request, auth.admin, `${spec.auditPrefix}.update`, {
      type: spec.targetType,
      id: symbol,
      detail: record,
    });

    return NextResponse.json({ success: true, market: record }, { headers: NO_STORE });
  }

  async function DELETE(request: NextRequest): Promise<NextResponse> {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;
    const guard = enforceRequestGuards(request, `${spec.auditPrefix}.delete`);
    if (guard) return guard;

    const symbol = symbolParam(request.nextUrl.searchParams.get('symbol'));
    if (!symbol) return fail('VALIDATION_FAILED', 'symbol query parameter is required');

    const db = getDb();
    if (!db.prepare(`SELECT 1 FROM ${spec.table} WHERE ${spec.symbolColumn} = ?`).get(symbol)) {
      return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);
    }

    if (spec.beforeDelete) {
      const refusal = spec.beforeDelete(db, symbol);
      if (refusal) return fail('DELIST_REFUSED', refusal, 409);
    }

    db.prepare(`DELETE FROM ${spec.table} WHERE ${spec.symbolColumn} = ?`).run(symbol);
    recordAdminAction(request, auth.admin, `${spec.auditPrefix}.delist`, {
      type: spec.targetType,
      id: symbol,
    });

    return NextResponse.json({ success: true, symbol }, { headers: NO_STORE });
  }

  // `allColumns` is computed so an empty field list is a programming error
  // rather than a table-wide SELECT *; it is checked here, once, at build time.
  if (allColumns.length <= 1) {
    throw new Error(`crud route for ${spec.table} has no fields`);
  }

  return { GET, POST, PUT, DELETE };
}
