'use client';

import { useState } from 'react';

interface Notification {
  id: string;
  type: 'email' | 'sms' | 'push' | 'system';
  title: string;
  message: string;
  recipients: number;
  sentAt: string;
  status: 'sent' | 'pending' | 'failed';
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([
    { id: '1', type: 'email', title: 'Maintenance Alert', message: 'System maintenance scheduled', recipients: 15000, sentAt: '2024-01-15 10:00', status: 'sent' },
    { id: '2', type: 'push', title: 'New Feature', message: 'Check out our new futures trading', recipients: 25000, sentAt: '2024-01-14 15:30', status: 'sent' },
    { id: '3', type: 'sms', title: 'Security Alert', message: 'New login detected', recipients: 5000, sentAt: '2024-01-14 12:00', status: 'sent' },
    { id: '4', type: 'system', title: 'Rate Limit Warning', message: 'API rate limit reached', recipients: 100, sentAt: '2024-01-13 09:00', status: 'failed' },
  ]);
  const [sending, setSending] = useState(false);

  const sendNotification = async () => {
    setSending(true);
    setTimeout(() => setSending(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Notification Center</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Send New Notification</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select className="w-full px-3 py-2 border rounded-lg">
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="push">Push Notification</option>
                <option value="system">System Message</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Recipients</label>
              <select className="w-full px-3 py-2 border rounded-lg">
                <option value="all">All Users</option>
                <option value="active">Active Users</option>
                <option value="vip">VIP Users</option>
                <option value="custom">Custom Group</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Title</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg" placeholder="Notification title" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Message</label>
              <textarea className="w-full px-3 py-2 border rounded-lg" rows={3} placeholder="Notification message" />
            </div>
          </div>
          <button
            onClick={sendNotification}
            disabled={sending}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send Notification'}
          </button>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Notification History</h2>
          </div>
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Recipients</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sent At</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {notifications.map((notif) => (
                <tr key={notif.id}>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded ${
                      notif.type === 'email' ? 'bg-blue-100 text-blue-800' :
                      notif.type === 'sms' ? 'bg-green-100 text-green-800' :
                      notif.type === 'push' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {notif.type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium">{notif.title}</div>
                    <div className="text-sm text-gray-500">{notif.message}</div>
                  </td>
                  <td className="px-6 py-4 text-right">{notif.recipients.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{notif.sentAt}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      notif.status === 'sent' ? 'bg-green-100 text-green-800' :
                      notif.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {notif.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
