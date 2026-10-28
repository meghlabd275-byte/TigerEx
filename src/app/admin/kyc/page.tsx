'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface KYCApplication {
  id: string;
  userId: string;
  firstName?: string;
  lastName?: string;
  documentType?: string;
  country?: string;
  level: number;
  status: string;
  submittedAt?: number;
  reviewedAt?: number;
  rejectReason?: string;
}

function formatTimestamp(value: number | undefined): string {
  if (!value) return '—';
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminKYCPanel() {
  const queue = useApiResource<unknown>('/api/admin/kyc?status=pending');
  const submissions = useMemo(() => toArray<KYCApplication>(queue.data), [queue.data]);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const review = async (userId: string, approve: boolean) => {
    const reason = approve ? '' : window.prompt('Rejection reason') ?? '';
    if (!approve && !reason.trim()) return;

    setBusyUser(userId);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
      const response = await fetch(`/api/admin/kyc/${encodeURIComponent(userId)}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ approve, level: approve ? 2 : 0, reason }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success !== false) {
        setMessage({ ok: true, text: approve ? 'Application approved.' : 'Application rejected.' });
        queue.reload();
      } else {
        setMessage({ ok: false, text: body?.error || `Review failed (${response.status})` });
      }
    } catch {
      setMessage({ ok: false, text: 'Review request failed.' });
    } finally {
      setBusyUser(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">KYC Verification</h1>
          <button
            onClick={queue.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              message.ok
                ? 'border border-green-200 bg-green-50 text-green-800'
                : 'border border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {queue.loading && <p className="text-sm text-gray-500">Loading review queue…</p>}
        {queue.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The KYC queue is unavailable: {queue.error}
          </div>
        )}

        {!queue.loading && !queue.error && (
          <div className="rounded-lg bg-white shadow">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">
                Pending Submissions ({submissions.length})
              </h2>
            </div>
            {submissions.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500">
                No pending KYC submissions.
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {submissions.map((sub) => (
                  <div key={sub.id} className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {[sub.firstName, sub.lastName].filter(Boolean).join(' ') || sub.userId}
                          </span>
                          <span className="text-sm text-gray-500">Level {sub.level}</span>
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {sub.status}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          User: {sub.userId} · Document: {sub.documentType || '—'} · Country:{' '}
                          {sub.country || '—'}
                        </div>
                        <div className="text-sm text-gray-500">
                          Submitted: {formatTimestamp(sub.submittedAt)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={busyUser === sub.userId}
                          onClick={() => review(sub.userId, true)}
                          className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyUser === sub.userId}
                          onClick={() => review(sub.userId, false)}
                          className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
