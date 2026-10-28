'use client';

/**
 * Broadcast centre. Announcements are created and read from the admin backend;
 * a published announcement is what traders see in the notification feed.
 */

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface Announcement {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ['general', 'listing', 'maintenance', 'security'];

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminNotificationsPage() {
  const announcements = useApiResource<{ data?: Announcement[] }>('/api/admin/announcements');
  const list = useMemo(() => announcements.data?.data ?? [], [announcements.data]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [pinned, setPinned] = useState(false);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const authToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      setMessage({ ok: false, text: 'A title and body are required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const token = authToken();
      const response = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          body,
          category,
          pinned,
          status: publish ? 'published' : 'draft',
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success !== false) {
        setMessage({ ok: true, text: publish ? 'Announcement published.' : 'Draft saved.' });
        setTitle('');
        setBody('');
        setPinned(false);
        announcements.reload();
      } else {
        setMessage({
          ok: false,
          text: payload?.error?.message || payload?.error || 'Create failed.',
        });
      }
    } catch {
      setMessage({ ok: false, text: 'Create request failed.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this announcement?')) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = authToken();
      const response = await fetch(`/api/admin/announcements/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success !== false) {
        setMessage({ ok: true, text: 'Announcement deleted.' });
        announcements.reload();
      } else {
        setMessage({
          ok: false,
          text: payload?.error?.message || payload?.error || 'Delete failed.',
        });
      }
    } catch {
      setMessage({ ok: false, text: 'Delete request failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Notification Center</h1>
          <button
            onClick={announcements.reload}
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

        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">New Announcement</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Category</label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                />
                Pin to top
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(event) => setPublish(event.target.checked)}
                />
                Publish immediately
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Title</label>
              <input
                type="text"
                className="w-full rounded-lg border px-3 py-2"
                placeholder="Announcement title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Message</label>
              <textarea
                className="w-full rounded-lg border px-3 py-2"
                rows={3}
                placeholder="Announcement message"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
          </div>
          <button
            onClick={create}
            disabled={busy}
            className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : publish ? 'Publish' : 'Save Draft'}
          </button>
        </div>

        {announcements.loading && <p className="text-sm text-gray-500">Loading announcements…</p>}
        {announcements.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Announcements are unavailable: {announcements.error}
          </div>
        )}

        {!announcements.loading && !announcements.error && (
          <div className="rounded-lg bg-white shadow">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Announcement History</h2>
            </div>
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Category', 'Title', 'Status', 'Created', 'Actions'].map((heading) => (
                    <th
                      key={heading}
                      className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                      No announcements have been created.
                    </td>
                  </tr>
                ) : (
                  list.map((item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4">
                        <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium">
                          {item.pinned && (
                            <span className="mr-2 text-xs text-blue-600">pinned</span>
                          )}
                          {item.title}
                        </div>
                        <div className="text-sm text-gray-500">{item.body}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            item.status === 'published'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatDate(item.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => remove(item.id)}
                          disabled={busy}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
