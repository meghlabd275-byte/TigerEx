'use client';

/**
 * A generic admin resource view.
 *
 * Most admin sections are "read a list, optionally run an action". This
 * component renders that shape from a small spec: it loads the endpoint with
 * the admin token, finds the first array in the payload, and renders it as a
 * table. When the spec declares actions it renders the matching controls and
 * posts them to the endpoint.
 *
 * Nested objects are shown as JSON rather than dropped, so an operator sees
 * the real record instead of a blank cell.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Play } from 'lucide-react';
import { readAdminToken } from '@/lib/auth/token';

export interface ResourceAction {
  label: string;
  method: 'POST' | 'PUT' | 'DELETE';
  /** Build the request URL; the default is the list endpoint. */
  url?: (row: Record<string, unknown> | null) => string;
  fields?: Array<{ name: string; label: string; type?: 'text' | 'number' | 'select'; options?: string[] }>;
  /** Build the request body from the entered values and the row, if any. */
  body?: (values: Record<string, string>, row: Record<string, unknown> | null) => Record<string, unknown>;
}

export interface ResourceSpec {
  title: string;
  description: string;
  endpoint: string;
  /** Which key of the payload holds the list; auto-detected when omitted. */
  rowsKey?: string;
  columns?: string[];
  actions?: ResourceAction[];
}

type Row = Record<string, unknown>;

function adminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return readAdminToken();
}

function firstArray(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload as Row[];
  if (!payload || typeof payload !== 'object') return [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (Array.isArray(value)) return value as Row[];
  }
  return [];
}

/** Resolve a dotted path such as `data.positions` against the payload. */
function atPath(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function AdminResource({ spec }: { spec: ResourceSpec }) {
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [activeAction, setActiveAction] = useState<ResourceAction | null>(null);
  const [activeRow, setActiveRow] = useState<Row | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = adminToken();
      const response = await fetch(spec.endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success === false) {
        setError(body?.error?.message || body?.error || `Could not load ${spec.title.toLowerCase()}.`);
        setPayload(null);
        return;
      }
      setPayload(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this section.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [spec.endpoint, spec.title]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (spec.rowsKey && payload) {
      const value = atPath(payload, spec.rowsKey);
      if (Array.isArray(value)) return value as Row[];
      if (value !== undefined) return [];
    }
    return firstArray(payload);
  }, [payload, spec.rowsKey]);

  const columns = useMemo(() => {
    if (spec.columns && spec.columns.length > 0) return spec.columns;
    const keys = new Set<string>();
    for (const row of rows.slice(0, 20)) for (const key of Object.keys(row)) keys.add(key);
    return Array.from(keys).slice(0, 8);
  }, [rows, spec.columns]);

  const run = async (
    action: ResourceAction | null = activeAction,
    row: Row | null = activeRow,
    entered: Record<string, string> = values,
  ) => {
    if (!action) return;
    setBusy(true);
    setStatus(null);
    try {
      const token = adminToken();
      const url = action.url ? action.url(row) : spec.endpoint;
      const body = action.body ? action.body(entered, row) : undefined;
      const response = await fetch(url, {
        method: action.method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success === false) {
        setStatus({ ok: false, text: result?.error?.message || result?.error || 'The action was refused.' });
        return;
      }
      setStatus({ ok: true, text: `${action.label} completed.` });
      setActiveAction(null);
      setActiveRow(null);
      setValues({});
      await load();
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : 'The action was refused.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{spec.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">{spec.description}</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-gray-500 hover:text-gray-900"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {status && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            status.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {status.text}
        </div>
      )}

      {spec.actions && spec.actions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {spec.actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                setActiveAction(action);
                setActiveRow(null);
                setValues({});
                // An action with no fields is a one-shot command; run it
                // immediately rather than opening an empty form.
                if (!action.fields || action.fields.length === 0) void run(action, null, {});
              }}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm text-white"
            >
              <Play className="h-3 w-3" /> {action.label}
            </button>
          ))}
        </div>
      )}

      {activeAction && (
        <div className="mb-6 rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 text-lg font-semibold">{activeAction.label}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {(activeAction.fields ?? []).map((field) => (
              <label key={field.name} className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">{field.label}</span>
                {field.type === 'select' ? (
                  <select
                    value={values[field.name] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="w-full rounded border px-2 py-1"
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={values[field.name] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="w-full rounded border px-2 py-1"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Run
            </button>
            <button
              onClick={() => {
                setActiveAction(null);
                setActiveRow(null);
              }}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-lg border bg-white px-4 py-8 text-center text-gray-500">Nothing to show yet.</div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase text-gray-500">
                {columns.map((column) => (
                  <th key={column} className="px-4 py-3">
                    {column}
                  </th>
                ))}
                {spec.actions && spec.actions.some((action) => action.fields && action.fields.length > 0) && (
                  <th className="px-4 py-3" />
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, index) => (
                <tr key={String(row.id ?? row.symbol ?? index)}>
                  {columns.map((column) => (
                    <td key={column} className="px-4 py-3 text-sm">
                      {renderCell(row[column])}
                    </td>
                  ))}
                  {spec.actions && spec.actions.some((action) => action.fields && action.fields.length > 0) && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {(spec.actions ?? [])
                          .filter((action) => action.fields && action.fields.length > 0)
                          .map((action) => (
                            <button
                              key={action.label}
                              onClick={() => {
                                setActiveAction(action);
                                setActiveRow(row);
                                const initial: Record<string, string> = {};
                                for (const field of action.fields ?? []) {
                                  initial[field.name] = renderCell(row[field.name]) === '—' ? '' : renderCell(row[field.name]);
                                }
                                setValues(initial);
                              }}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {action.label}
                            </button>
                          ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
