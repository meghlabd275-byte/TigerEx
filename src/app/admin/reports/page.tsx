'use client';

import { useState } from 'react';

interface Report {
  id: string;
  type: 'volume' | 'revenue' | 'users' | 'trading';
  period: string;
  generatedAt: string;
  status: 'ready' | 'generating';
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const generateReport = async (type: string, period: string) => {
    setGenerating(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch('/api/admin/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ type, period }),
      });
      const data = await response.json();
      if (data.success) {
        alert('Report generated successfully');
      }
    } catch (error) {
      console.error('Failed to generate report:', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Reports</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Users</div>
            <div className="text-2xl font-bold">12,456</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">24h Volume</div>
            <div className="text-2xl font-bold">$4.2M</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Revenue</div>
            <div className="text-2xl font-bold">$125K</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Active Traders</div>
            <div className="text-2xl font-bold">3,892</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Generate New Report</h2>
          <div className="flex gap-4">
            <select id="reportType" className="px-4 py-2 border rounded-lg">
              <option value="volume">Volume Report</option>
              <option value="revenue">Revenue Report</option>
              <option value="users">User Report</option>
              <option value="trading">Trading Report</option>
            </select>
            <select id="reportPeriod" className="px-4 py-2 border rounded-lg">
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
            <button
              onClick={() => {
                const type = (document.getElementById('reportType') as HTMLSelectElement).value;
                const period = (document.getElementById('reportPeriod') as HTMLSelectElement).value;
                generateReport(type, period);
              }}
              disabled={generating}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Report History</h2>
          </div>
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Generated</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="px-6 py-4">Volume Report</td>
                <td className="px-6 py-4">Last 30 Days</td>
                <td className="px-6 py-4">2024-01-15 10:30</td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Ready</span>
                </td>
                <td className="px-6 py-4">
                  <button className="text-blue-600 hover:text-blue-800">Download</button>
                </td>
              </tr>
              <tr>
                <td className="px-6 py-4">Revenue Report</td>
                <td className="px-6 py-4">Last 7 Days</td>
                <td className="px-6 py-4">2024-01-14 08:15</td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Ready</span>
                </td>
                <td className="px-6 py-4">
                  <button className="text-blue-600 hover:text-blue-800">Download</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
