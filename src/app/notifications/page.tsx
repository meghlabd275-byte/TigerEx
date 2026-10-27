'use client';

import React, { useMemo, useState } from 'react';
import {
  Bell,
  Trash2,
  TrendingUp,
  TrendingDown,
  Wallet,
  Shield,
  AlertCircle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface Notification {
  id: string;
  type?: string;
  title?: string;
  message?: string;
  body?: string;
  created_at?: string;
  read?: boolean;
  is_read?: boolean;
}

function notificationType(n: Notification): string {
  return (n.type || 'system').toLowerCase();
}

function isRead(n: Notification): boolean {
  return n.read ?? n.is_read ?? false;
}

function formatTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function iconFor(type: string) {
  switch (type) {
    case 'price':
      return <TrendingUp className="w-5 h-5 text-green-500" />;
    case 'deposit':
      return <Wallet className="w-5 h-5 text-green-500" />;
    case 'security':
      return <Shield className="w-5 h-5 text-blue-500" />;
    case 'order':
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'warning':
      return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    case 'drop':
      return <TrendingDown className="w-5 h-5 text-red-500" />;
    default:
      return <Bell className="w-5 h-5 text-gray-400" />;
  }
}

export default function NotificationsPage() {
  const notifications = useApiResource<unknown>('/api/notifications?limit=50');
  const [filter, setFilter] = useState('all');
  const [dismissed, setDismissed] = useState<string[]>([]);

  const list = useMemo(() => {
    return toArray<Notification>(notifications.data)
      .map((n, index) => ({ ...n, id: n.id || `notification-${index}` }))
      .filter((n) => !dismissed.includes(n.id));
  }, [notifications.data, dismissed]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return list;
    if (filter === 'unread') return list.filter((n) => !isRead(n));
    return list.filter((n) => notificationType(n) === filter);
  }, [list, filter]);

  const unreadCount = list.filter((n) => !isRead(n)).length;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-gray-400">
              {notifications.loading ? 'Loading…' : `${unreadCount} unread`}
            </p>
          </div>
          <button
            onClick={notifications.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {notifications.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load notifications: {notifications.error}
          </div>
        )}

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {['all', 'unread', 'price', 'order', 'security', 'deposit'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm capitalize whitespace-nowrap ${
                filter === f ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filteredNotifications.map((notification) => {
            const type = notificationType(notification);
            const read = isRead(notification);
            return (
              <div
                key={notification.id}
                className={`bg-[#14141A] rounded-xl p-4 ${read ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#0A0A0F] flex items-center justify-center flex-shrink-0">
                      {iconFor(type)}
                    </div>
                    <div>
                      <p className="font-medium">{notification.title || type}</p>
                      <p className="text-sm text-gray-400">
                        {notification.message || notification.body || ''}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatTime(notification.created_at)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setDismissed((prev) => [...prev, notification.id])
                    }
                    className="p-2 hover:bg-red-500/20 rounded-lg"
                    aria-label="Dismiss notification"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {!notifications.loading && !notifications.error && filteredNotifications.length === 0 && (
          <div className="text-center py-12 text-gray-500 bg-[#14141A] rounded-xl">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No notifications</p>
          </div>
        )}
      </div>
    </div>
  );
}
