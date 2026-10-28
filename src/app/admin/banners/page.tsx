'use client';

/**
 * Banner management. Banners are persisted by the admin backend and served to
 * visitors through /api/content once their schedule window is active.
 */

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface Banner {
  id: string;
  title: string;
  image_url: string;
  link_url: string;
  placement: string;
  status: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

const PLACEMENTS = ['home', 'trade', 'earn'];

function formatDate(value: string | undefined): string {
  if (!value || value.startsWith('0001-')) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export default function AdminBannersPage() {
  const banners = useApiResource<{ data?: Banner[] }>('/api/admin/banners');
  const list = useMemo(() => banners.data?.data ?? [], [banners.data]);

  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [placement, setPlacement] = useState('home');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const authToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;

  const create = async () => {
    if (!title.trim() || !imageUrl.trim()) {
      setMessage({ ok: false, text: 'A title and image URL are required.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const token = authToken();
      const response = await fetch('/api/admin/banners', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          image_url: imageUrl,
          link_url: linkUrl,
          placement,
          starts_at: startsAt,
          ends_at: endsAt,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success !== false) {
        setMessage({ ok: true, text: 'Banner created.' });
        setTitle('');
        setImageUrl('');
        setLinkUrl('');
        setStartsAt('');
        setEndsAt('');
        banners.reload();
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

  const setStatus = async (id: string, status: 'active' | 'paused') => {
    setBusy(true);
    setMessage(null);
    try {
      const token = authToken();
      const response = await fetch(`/api/admin/banners/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success !== false) {
        setMessage({ ok: true, text: `Banner ${status}.` });
        banners.reload();
      } else {
        setMessage({
          ok: false,
          text: payload?.error?.message || payload?.error || 'Update failed.',
        });
      }
    } catch {
      setMessage({ ok: false, text: 'Update request failed.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this banner?')) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = authToken();
      const response = await fetch(`/api/admin/banners/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success !== false) {
        setMessage({ ok: true, text: 'Banner deleted.' });
        banners.reload();
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
          <h1 className="text-2xl font-bold">Banner Management</h1>
          <button
            onClick={banners.reload}
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
          <h2 className="mb-4 text-lg font-semibold">Create New Banner</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Title</label>
              <input
                type="text"
                className="w-full rounded-lg border px-3 py-2"
                placeholder="Banner title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Placement</label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={placement}
                onChange={(event) => setPlacement(event.target.value)}
              >
                {PLACEMENTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Image URL</label>
              <input
                type="url"
                className="w-full rounded-lg border px-3 py-2"
                placeholder="https://cdn.example.com/banner.png"
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Link URL</label>
              <input
                type="text"
                className="w-full rounded-lg border px-3 py-2"
                placeholder="/promo/link"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Start Date</label>
              <input
                type="date"
                className="w-full rounded-lg border px-3 py-2"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">End Date</label>
              <input
                type="date"
                className="w-full rounded-lg border px-3 py-2"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </div>
          </div>
          <button
            onClick={create}
            disabled={busy}
            className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Create Banner'}
          </button>
        </div>

        {banners.loading && <p className="text-sm text-gray-500">Loading banners…</p>}
        {banners.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Banners are unavailable: {banners.error}
          </div>
        )}

        {!banners.loading && !banners.error && (
          <div className="rounded-lg bg-white shadow">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Banners</h2>
            </div>
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Title', 'Placement', 'Image', 'Link', 'Period', 'Status', 'Actions'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                      No banners have been created.
                    </td>
                  </tr>
                ) : (
                  list.map((banner) => (
                    <tr key={banner.id}>
                      <td className="px-6 py-4 font-medium">{banner.title}</td>
                      <td className="px-6 py-4">{banner.placement}</td>
                      <td className="px-6 py-4">
                        {/* Operator-supplied asset; rendered as an image, never as markup. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={banner.image_url}
                          alt={banner.title}
                          className="h-10 w-20 rounded object-cover"
                        />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{banner.link_url || '—'}</td>
                      <td className="px-6 py-4 text-sm">
                        {formatDate(banner.starts_at)} – {formatDate(banner.ends_at)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            banner.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {banner.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() =>
                            setStatus(banner.id, banner.status === 'active' ? 'paused' : 'active')
                          }
                          disabled={busy}
                          className="mr-3 text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                          {banner.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          onClick={() => remove(banner.id)}
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
