'use client';

import { useState } from 'react';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState({
    tradingFee: '0.1',
    withdrawalFee: '1',
    minWithdrawal: '10',
    maxWithdrawal: '1000000',
    enableTrading: true,
    enableWithdrawals: true,
    enableDeposits: true,
    maintenanceMode: false,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (data.success) {
        alert('Settings saved successfully');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Exchange Settings</h1>
        
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-4">Fee Settings</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Trading Fee (%)</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={settings.tradingFee}
                  onChange={(e) => setSettings({...settings, tradingFee: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Withdrawal Fee</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={settings.withdrawalFee}
                  onChange={(e) => setSettings({...settings, withdrawalFee: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Min Withdrawal</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={settings.minWithdrawal}
                  onChange={(e) => setSettings({...settings, minWithdrawal: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Max Withdrawal</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={settings.maxWithdrawal}
                  onChange={(e) => setSettings({...settings, maxWithdrawal: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">System Status</h2>
            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={settings.enableTrading}
                  onChange={(e) => setSettings({...settings, enableTrading: e.target.checked})}
                />
                Enable Trading
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={settings.enableWithdrawals}
                  onChange={(e) => setSettings({...settings, enableWithdrawals: e.target.checked})}
                />
                Enable Withdrawals
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={settings.enableDeposits}
                  onChange={(e) => setSettings({...settings, enableDeposits: e.target.checked})}
                />
                Enable Deposits
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={settings.maintenanceMode}
                  onChange={(e) => setSettings({...settings, maintenanceMode: e.target.checked})}
                />
                Maintenance Mode
              </label>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
