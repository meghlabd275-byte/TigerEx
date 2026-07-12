'use client';

import React, { useState } from 'react';
import { 
  Settings, 
  User, 
  Shield, 
  Bell, 
  Lock, 
  Key, 
  Globe, 
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  LogOut,
  Languages
} from 'lucide-react';

export default function WalletSettings() {
  const [activeSection, setActiveSection] = useState('profile');
  const [darkMode, setDarkMode] = useState(true);
  const [notifications, setNotifications] = useState({
    push: true,
    email: true,
    sms: false,
    priceAlerts: true,
    transactions: true,
    marketing: false,
  });
  const [security, setSecurity] = useState({
    twoFactor: true,
    antiPhishing: false,
    withdrawalWhitelist: false,
  });

  const sections = [
    {
      id: 'profile',
      title: 'Profile',
      icon: <User className="w-5 h-5" />,
      items: [
        { id: 'username', label: 'Username', type: 'info', value: 'tiger_user' },
        { id: 'email', label: 'Email', type: 'info', value: 'user@example.com' },
        { id: 'phone', label: 'Phone', type: 'link', value: '+1 *** *** **89' },
        { id: 'referral', label: 'Referral Code', type: 'link', value: 'TGR123456' },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      icon: <Shield className="w-5 h-5" />,
      items: [
        { id: 'twoFactor', label: 'Two-Factor Authentication', description: 'Add extra security', type: 'toggle', value: security.twoFactor },
        { id: 'antiPhishing', label: 'Anti-Phishing Code', type: 'toggle', value: security.antiPhishing },
        { id: 'withdrawalWhitelist', label: 'Withdrawal Whitelist', type: 'toggle', value: security.withdrawalWhitelist },
        { id: 'changePassword', label: 'Change Password', type: 'link' },
        { id: 'apiKeys', label: 'API Keys', type: 'link' },
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: <Bell className="w-5 h-5" />,
      items: [
        { id: 'push', label: 'Push Notifications', type: 'toggle', value: notifications.push },
        { id: 'email', label: 'Email Notifications', type: 'toggle', value: notifications.email },
        { id: 'priceAlerts', label: 'Price Alerts', type: 'toggle', value: notifications.priceAlerts },
      ],
    },
    {
      id: 'preferences',
      title: 'Preferences',
      icon: <Globe className="w-5 h-5" />,
      items: [
        { id: 'language', label: 'Language', type: 'link', value: 'English' },
        { id: 'currency', label: 'Fiat Currency', type: 'link', value: 'USD' },
        { id: 'theme', label: 'Dark Mode', type: 'toggle', value: darkMode },
      ],
    },
    {
      id: 'wallet',
      title: 'Wallet',
      icon: <Key className="w-5 h-5" />,
      items: [
        { id: 'backupPhrase', label: 'Backup Recovery Phrase', type: 'link' },
        { id: 'exportPrivate', label: 'Export Private Keys', type: 'action' },
        { id: 'viewAddresses', label: 'View All Addresses', type: 'link' },
      ],
    },
    {
      id: 'danger',
      title: 'Danger Zone',
      icon: <AlertTriangle className="w-5 h-5" />,
      items: [
        { id: 'deleteAccount', label: 'Delete Account', type: 'action', description: 'Permanently delete your account' },
      ],
    },
  ];

  const renderItem = (item: any) => {
    if (item.type === 'toggle') {
      return (
        <button onClick={() => {
          if (item.id === 'twoFactor') setSecurity({...security, twoFactor: !security.twoFactor});
          if (item.id === 'antiPhishing') setSecurity({...security, antiPhishing: !security.antiPhishing});
          if (item.id === 'withdrawalWhitelist') setSecurity({...security, withdrawalWhitelist: !security.withdrawalWhitelist});
          if (item.id === 'push') setNotifications({...notifications, push: !notifications.push});
          if (item.id === 'email') setNotifications({...notifications, email: !notifications.email});
          if (item.id === 'priceAlerts') setNotifications({...notifications, priceAlerts: !notifications.priceAlerts});
          if (item.id === 'theme') setDarkMode(!darkMode);
        }}>
          {item.value ? <ToggleRight className="w-6 h-6 text-[#FF6B35]" /> : <ToggleLeft className="w-6 h-6 text-gray-500" />}
        </button>
      );
    }
    return <ChevronRight className="w-5 h-5 text-gray-500 ml-auto" />;
  };

  const currentSection = sections.find(s => s.id === activeSection);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <div className="flex gap-4">
          <div className="w-64 flex-shrink-0">
            <div className="bg-[#14141A] rounded-xl p-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition ${
                    activeSection === section.id ? 'bg-[#FF6B35] text-white' : 'text-gray-400 hover:bg-[#1E1E24]'
                  }`}
                >
                  {section.icon}
                  <span>{section.title}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 bg-[#14141A] rounded-xl p-4">
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-red-500 hover:bg-red-500/10 transition">
                <LogOut className="w-5 h-5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
          <div className="flex-1">
            <div className="bg-[#14141A] rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">{currentSection?.title}</h2>
              <div className="space-y-1">
                {currentSection?.items.map((item) => (
                  <div key={item.id} className={`flex items-center p-4 rounded-lg hover:bg-[#1E1E24] transition ${item.id === 'deleteAccount' ? 'border border-red-500/30' : ''}`}>
                    <div className="flex-1">
                      <p className={`font-medium ${item.id === 'deleteAccount' ? 'text-red-500' : 'text-white'}`}>{item.label}</p>
                      {item.description && <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>}
                    </div>
                    {renderItem(item)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
