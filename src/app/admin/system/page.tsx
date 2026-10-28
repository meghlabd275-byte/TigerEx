'use client';

import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface SystemStatus {
  success?: boolean;
  data?: {
    status?: string;
    service?: string;
    timestamp?: string;
    uptime?: string;
    goroutines?: number;
    heap_bytes?: number;
    counters?: Record<string, number>;
  };
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || value === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

export default function AdminSystemPage() {
  const status = useApiResource<SystemStatus>('/api/admin/system/status');
  const data = status.data?.data;

  const metrics: { label: string; value: string }[] = data
    ? [
        { label: 'Service', value: data.service ?? '—' },
        { label: 'Status', value: data.status ?? '—' },
        { label: 'Uptime', value: data.uptime ?? '—' },
        { label: 'Goroutines', value: data.goroutines?.toLocaleString() ?? '—' },
        { label: 'Heap', value: formatBytes(data.heap_bytes) },
        { label: 'Timestamp', value: data.timestamp ?? '—' },
      ]
    : [];

  const counters = Object.entries(data?.counters ?? {});

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">System Status</h1>
          <button
            onClick={status.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {status.loading && <p className="text-sm text-gray-500">Loading system status…</p>}
        {status.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            System status is unavailable: {status.error}
          </div>
        )}

        {!status.loading && !status.error && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-lg bg-white p-4 shadow">
                  <div className="text-sm text-gray-500">{metric.label}</div>
                  <div className="break-words text-lg font-bold">{metric.value}</div>
                </div>
              ))}
            </div>

            <h2 className="mb-3 text-lg font-semibold">Record Counters</h2>
            {counters.length === 0 ? (
              <div className="rounded-lg border bg-white px-4 py-8 text-center text-gray-500">
                No counters are reported.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {counters.map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-white p-4 shadow">
                    <div className="text-sm text-gray-500">{key.replace(/_/g, ' ')}</div>
                    <div className="text-2xl font-bold">{value.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
