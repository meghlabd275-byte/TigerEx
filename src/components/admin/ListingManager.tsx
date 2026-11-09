'use client';

/**
 * A generic listing manager for the admin console.
 *
 * Every market family (spot, futures, perpetuals, margin, options, leveraged
 * tokens, TradFi) is a listing table with the same four operations, so the
 * console drives them all from one component. The form builds the exact body
 * the route validates: numbers are parsed, JSON columns are parsed and
 * re-serialised, and an edit reuses the row's own symbol as the key.
 *
 * The admin token is read from `localStorage['tigerex_admin_token']` — the same
 * key the admin login writes — so a trader session can never drive these calls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, X } from 'lucide-react';
import { readAdminToken } from '@/lib/auth/token';

export interface ListingField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'json' | 'checkbox';
  options?: string[];
  required?: boolean;
  step?: string;
  placeholder?: string;
  help?: string;
}

export interface ListingSpec {
  title: string;
  description: string;
  endpoint: string;
  listKey: string;
  symbolField: string;
  fields: ListingField[];
  defaults?: Record<string, unknown>;
}

type Row = Record<string, unknown>;

function adminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return readAdminToken();
}

function messageOf(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return fallback;
}

/** Build the request body for a field from the form's string value. */
function coerce(field: ListingField, raw: string): unknown {
  if (field.type === 'number') {
    if (raw.trim() === '') return undefined;
    return Number(raw);
  }
  if (field.type === 'checkbox') return raw === 'true';
  if (field.type === 'json') {
    if (raw.trim() === '') return undefined;
    return JSON.parse(raw);
  }
  return raw;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function ListingManager({ spec }: { spec: ListingSpec }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of spec.fields) {
      const value = spec.defaults?.[field.name];
      initial[field.name] =
        field.type === 'checkbox' ? String(value === true) : value === undefined ? '' : String(value);
    }
    return initial;
  });
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);

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
        setError(messageOf(body, `Could not load ${spec.title.toLowerCase()}.`));
        setRows([]);
        return;
      }
      const list = body?.[spec.listKey];
      setRows(Array.isArray(list) ? list : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the listings.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [spec.endpoint, spec.listKey, spec.title]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    const cleared: Record<string, string> = {};
    for (const field of spec.fields) {
      const value = spec.defaults?.[field.name];
      cleared[field.name] =
        field.type === 'checkbox' ? String(value === true) : value === undefined ? '' : String(value);
    }
    setForm(cleared);
    setEditingSymbol(null);
  };

  const submit = async () => {
    setStatus(null);
    const body: Record<string, unknown> = {};
    try {
      for (const field of spec.fields) {
        const raw = form[field.name] ?? '';
        if (field.required && raw.trim() === '') {
          setStatus({ ok: false, text: `${field.label} is required.` });
          return;
        }
        const value = coerce(field, raw);
        if (value !== undefined) body[field.name] = value;
      }
    } catch {
      setStatus({ ok: false, text: 'A JSON field is not valid JSON.' });
      return;
    }

    setBusy(true);
    try {
      const token = adminToken();
      const response = await fetch(spec.endpoint, {
        method: editingSymbol ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        setStatus({ ok: false, text: messageOf(payload, 'The listing was refused.') });
        return;
      }
      setStatus({ ok: true, text: editingSymbol ? 'Listing updated.' : 'Listing created.' });
      resetForm();
      await load();
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : 'The listing was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (symbol: string) => {
    setStatus(null);
    setBusy(true);
    try {
      const token = adminToken();
      const response = await fetch(`${spec.endpoint}?symbol=${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        setStatus({ ok: false, text: messageOf(payload, 'The listing could not be removed.') });
        return;
      }
      setStatus({ ok: true, text: `${symbol} removed.` });
      await load();
    } catch (cause) {
      setStatus({ ok: false, text: cause instanceof Error ? cause.message : 'The listing could not be removed.' });
    } finally {
      setBusy(false);
    }
  };

  const edit = (row: Row) => {
    const next: Record<string, string> = {};
    for (const field of spec.fields) {
      next[field.name] = displayValue(row[field.name]);
    }
    setForm(next);
    setEditingSymbol(String(row[spec.symbolField] ?? ''));
  };

  const columns = useMemo(() => spec.fields.slice(0, 6).map((field) => field.name), [spec.fields]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
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

        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">
            {editingSymbol ? `Edit ${editingSymbol}` : `List a new market`}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {spec.fields.map((field) => (
              <label key={field.name} className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  {field.label}
                  {field.required && <span className="text-red-500"> *</span>}
                </span>
                {field.type === 'select' ? (
                  <select
                    value={form[field.name] ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="w-full rounded border px-2 py-1"
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={form[field.name] === 'true'}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [field.name]: String(event.target.checked) }))
                    }
                    className="h-4 w-4"
                  />
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    step={field.step}
                    placeholder={field.placeholder}
                    value={form[field.name] ?? ''}
                    onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="w-full rounded border px-2 py-1"
                  />
                )}
                {field.help && <span className="mt-1 block text-xs text-gray-400">{field.help}</span>}
              </label>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {editingSymbol ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingSymbol ? 'Save changes' : 'Create listing'}
            </button>
            {editingSymbol && (
              <button
                onClick={resetForm}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            )}
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading listings…</p>}
        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="rounded-lg border bg-white px-4 py-8 text-center text-gray-500">
            No markets are listed.
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg bg-white shadow">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase text-gray-500">
                  {columns.map((column) => (
                    <th key={column} className="px-4 py-3">
                      {spec.fields.find((field) => field.name === column)?.label ?? column}
                    </th>
                  ))}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const symbol = String(row[spec.symbolField] ?? '');
                  return (
                    <tr key={symbol}>
                      {columns.map((column) => (
                        <td key={column} className="px-4 py-3 text-sm">
                          {displayValue(row[column]) || '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-sm">{displayValue(row.status) || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => edit(row)}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            onClick={() => remove(symbol)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" /> Delist
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
