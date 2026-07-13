'use client';

import { useState } from 'react';

interface AuditLog {
  id: string;
  action: string;
  user: string;
  ip: string;
  timestamp: string;
  status: 'success' | 'failed';
  details: string;
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([
    { id: '1', action: 'User Login', user: 'john@example.com', ip: '192.168.1.1', timestamp: '2024-01-15 14:30:00', status: 'success', details: 'Login successful' },
    { id: '2', action: 'Withdrawal', user: 'jane@example.com', ip: '192.168.1.2', timestamp: '2024-01-15 14:25:00', status: 'success', details: 'Withdrew 1.5 BTC' },
    { id: '3', action: 'KYC Submission', user: 'bob@example.com', ip: '192.168.1.3', timestamp: '2024-01-15 14:20:00', status: 'success', details: 'Level 2 KYC submitted' },
    { id: '4', action: 'Failed Login', user: 'hacker@example.com', ip: '10.0.0.1', timestamp: '2024-01-15 14:15:00', status: 'failed', details: 'Invalid password' },
    { id: '5', action: 'API Key Created', user: 'alice@example.com', ip: '192.168.1.5', timestamp: '2024-01-15 14:10:00', status: 'success', details: 'New API key generated' },
  ]);
  const [filter, setFilter] = useState('all');

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.status === filter);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Audit Logs</h1>
        
        <div className="flex gap-4 mb-6">
          <select
            className="px-4 py-2 border rounded-lg"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All Logs</option>
            <option value="success">Successful</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-6 py-4 text-sm text-gray-500">{log.timestamp}</td>
                  <td className="px-6 py-4 font-medium">{log.action}</td>
                  <td className="px-6 py-4 text-sm">{log.user}</td>
                  <td className="px-6 py-4 text-sm font-mono">{log.ip}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      log.status === 'success' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
