'use client';

import { useState } from 'react';

interface Permission {
  id: string;
  name: string;
  description: string;
  category: string;
}

export default function AdminPermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([
    { id: '1', name: 'users.read', description: 'View user list', category: 'users' },
    { id: '2', name: 'users.write', description: 'Create/update users', category: 'users' },
    { id: '3', name: 'users.delete', description: 'Delete users', category: 'users' },
    { id: '4', name: 'trading.view', description: 'View trading data', category: 'trading' },
    { id: '5', name: 'trading.execute', description: 'Execute trades', category: 'trading' },
    { id: '6', name: 'wallet.view', description: 'View wallet data', category: 'wallet' },
    { id: '7', name: 'wallet.withdraw', description: 'Process withdrawals', category: 'wallet' },
    { id: '8', name: 'admin.full', description: 'Full admin access', category: 'admin' },
  ]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const togglePermission = (permId: string) => {
    setSelectedPermissions(prev => 
      prev.includes(permId) 
        ? prev.filter(id => id !== permId)
        : [...prev, permId]
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Permission Management</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Available Permissions</h2>
            <div className="space-y-3">
              {permissions.map((perm) => (
                <div 
                  key={perm.id} 
                  className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                  onClick={() => togglePermission(perm.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{perm.name}</div>
                      <div className="text-sm text-gray-500">{perm.description}</div>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={selectedPermissions.includes(perm.id)}
                      onChange={() => togglePermission(perm.id)}
                    />
                  </div>
                  <div className="mt-2">
                    <span className="text-xs px-2 py-1 bg-gray-100 rounded">{perm.category}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Role Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Role Name</label>
                <input type="text" className="w-full px-3 py-2 border rounded-lg" placeholder="Enter role name" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea className="w-full px-3 py-2 border rounded-lg" rows={3} placeholder="Enter description" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Selected Permissions ({selectedPermissions.length})</label>
                <div className="flex flex-wrap gap-2">
                  {selectedPermissions.map(id => {
                    const perm = permissions.find(p => p.id === id);
                    return perm ? (
                      <span key={id} className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                        {perm.name}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
              <button className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700">
                Create Role
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
