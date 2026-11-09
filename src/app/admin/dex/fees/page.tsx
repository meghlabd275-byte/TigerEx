'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card } from '@/components/dex/AdminDexShell';

interface SettingsResponse {
  settings: Array<{ key: string; value: string; updated_at: string }>;
}

const SPLIT_KEYS = [
  'dex_swap_fee_split_lp_bps',
  'dex_swap_fee_split_vetgr_bps',
  'dex_swap_fee_split_treasury_bps',
  'dex_swap_fee_split_insurance_bps',
  'dex_swap_fee_split_burn_bps',
];

const SCALAR_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'dex_max_slippage', label: 'Maximum slippage', hint: 'A fraction below 1, e.g. 0.15 for 15%' },
  { key: 'dex_default_slippage', label: 'Default slippage', hint: 'A fraction below 1' },
  { key: 'dex_max_price_impact', label: 'Maximum price impact', hint: 'A fraction below 1' },
  { key: 'dex_settlement_fee_bps', label: 'Settlement fee (bps)', hint: 'An integer' },
  { key: 'dex_gasless_free_swaps_per_day', label: 'Free gasless swaps per day', hint: 'An integer' },
  { key: 'dex_flash_loan_fee', label: 'Flash loan fee', hint: 'A fraction below 1' },
  { key: 'dex_nft_fee_bps', label: 'NFT sale fee (bps)', hint: 'An integer' },
  { key: 'dex_bridge_fee_bps', label: 'Bridge fee (bps)', hint: 'An integer' },
  { key: 'dex_insurance_fund_target', label: 'Insurance fund target', hint: 'An amount' },
];

export default function AdminDexFeesPage() {
  const settings = useApiResource<SettingsResponse>('/api/admin/dex/fees');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    const next: Record<string, string> = {};
    for (const setting of settings.data.settings) next[setting.key] = setting.value;
    setValues(next);
  }, [settings.data]);

  const splitTotal = useMemo(
    () => SPLIT_KEYS.reduce((sum, key) => sum + Number(values[key] ?? 0), 0),
    [values],
  );

  const save = async (keys: string[]) => {
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, number> = {};
      for (const key of keys) {
        if (values[key] === undefined || values[key] === '') continue;
        body[key] = Number(values[key]);
      }
      if (Object.keys(body).length === 0) {
        setMessage({ ok: false, text: 'Nothing to save.' });
        return;
      }
      await apiRequest('/api/admin/dex/fees', { method: 'PUT', body });
      setMessage({ ok: true, text: 'DEX settings saved. They take effect on the next settlement.' });
      settings.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not save the settings.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Fees and revenue splits"
      subtitle="These settings are read by the settlement path on every trade, so a change takes effect without a redeploy. A swap-fee split must always sum to 10000 basis points."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Swap fee split (basis points)"
          actions={
            <span className={splitTotal === 10_000 ? 'text-xs text-green-600' : 'text-xs text-red-600'}>
              total {splitTotal} / 10000
            </span>
          }
        >
          {settings.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading settings…</p>}
          {settings.error && <p className="text-sm text-red-600 dark:text-red-400">{settings.error}</p>}
          {SPLIT_KEYS.map((key) => (
            <div key={key} className="mb-2">
              <label className="block text-xs text-gray-500 dark:text-slate-400">{key}</label>
              <input
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                value={values[key] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              />
            </div>
          ))}
          <button
            onClick={() => save(SPLIT_KEYS)}
            disabled={busy || splitTotal !== 10_000}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save split
          </button>
        </Card>

        <Card title="Protocol settings">
          {SCALAR_FIELDS.map((field) => (
            <div key={field.key} className="mb-2">
              <label className="block text-xs text-gray-500 dark:text-slate-400">
                {field.label} <span className="text-gray-400">({field.hint})</span>
              </label>
              <input
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                value={values[field.key] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </div>
          ))}
          <button
            onClick={() => save(SCALAR_FIELDS.map((field) => field.key))}
            disabled={busy}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save settings
          </button>
        </Card>
      </div>
    </AdminDexShell>
  );
}
