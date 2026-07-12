'use client';

import React, { useState } from 'react';
import { Bell, Check, Trash2, Settings, ChevronRight, TrendingUp, TrendingDown, Wallet, Shield, AlertCircle, CheckCircle } from 'lucide-react';

const NOTIFICATIONS = [
  { id: 1, type: 'price', title: 'Price Alert', message: 'BTC/USDT reached $68,000', time: '2 hours ago', read: false, icon: <TrendingUp className="w-5 h-5 text-green-500" /> },
  { id: 2, type: 'deposit', title: 'Deposit Confirmed', message: '1.5 USDT deposited to your wallet', time: '5 hours ago', read: false, icon: <Wallet className="w-5 h-5 text-green-500" /> },
  { id: 3, type: 'security', title: 'New Login', message: 'New login from Chrome on Windows', time: '1 day ago', read: true, icon: <Shield className="w-5 h-5 text-blue-500" /> },
  { id: 4, type: 'order', title: 'Order Filled', message: 'Your buy order for 100 TGR was filled', time: '2 days ago', read: true, icon: <CheckCircle className="w-5 h-5 text-green-500" /> },
  { id: 5, type: 'warning', title: 'Withdrawal Pending', message: 'Your withdrawal is being processed', time: '3 days ago', read: true, icon: <AlertCircle className="w-5 h-5 text-yellow-500" /> },
  { id: 6, type: 'price', title: 'Price Drop Alert', message: 'ETH/USDT dropped 5% in the last hour', time: '4 days ago', read: true, icon: <TrendingDown className="w-5 h-5 text-red-500" /> },
];

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(NOTIFICATIONS);
  const [filter, setFilter] = useState('all');

  const filteredNotifications = filter === 'all' ? notifications : 
    filter === 'unread' ? notifications.filter(n => !n.read) : 
    notifications.filter(n => n.type === filter);

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const deleteNotification = (id: number) => {
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-gray-400">{unreadCount} unread</p>
          </div>
          <div className="flex gap-2">
            <button onClick={markAllRead} className="px-4 py-2 bg-[#14141A] rounded-lg text-sm hover:bg-[#1E1E24]">
              Mark all read
            </button>
            <button className="p-2 bg-[#14141A] rounded-lg hover:bg-[#1E1E24]">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {['all', 'unread', 'price', 'deposit', 'order', 'security'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap capitalize ${filter === f ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="space-y-2">
          {filteredNotifications.map(notif => (
            <div key={notif.id} className={`bg-[#14141A] rounded-xl p-4 flex items-start gap-4 ${!notif.read ? 'border-l-4 border-[#FF6B35]' : ''}`}>
              <div className="w-10 h-10 rounded-full bg-[#0A0A0F] flex items-center justify-center flex-shrink-0">
                {notif.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{notif.title}</p>
                  <span className="text-xs text-gray-500">{notif.time}</span>
                </div>
                <p className="text-sm text-gray-400 mt-1">{notif.message}</p>
              </div>
              <button onClick={() => deleteNotification(notif.id)} className="p-2 hover:bg-[#0A0A0F] rounded-lg">
                <Trash2 className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          ))}
        </div>

        {filteredNotifications.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No notifications</p>
          </div>
        )}
      </div>
    </div>
  );
}
