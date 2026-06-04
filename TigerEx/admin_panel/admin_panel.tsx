import React, { useState, useEffect } from 'react';

interface User {
  id: string;
  email: string;
  kycLevel: number;
  kycStatus: string;
  status: string;
  country: string;
  lastLogin: string;
  createdAt: string;
}

interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: string;
}

interface Market {
  symbol: string;
  status: string;
  makerFee: number;
  takerFee: number;
}

export const AdminPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      switch (activeTab) {
        case 'users':
          const usersRes = await fetch('/api/admin/users');
          const usersData = await usersRes.json();
          setUsers(usersData);
          break;
        case 'orders':
          const ordersRes = await fetch('/api/admin/orders');
          const ordersData = await ordersRes.json();
          setOrders(ordersData);
          break;
        case 'markets':
          const marketsRes = await fetch('/api/admin/markets');
          const marketsData = await marketsRes.json();
          setMarkets(marketsData);
          break;
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
    setLoading(false);
  };

  const handleSuspendUser = async (userId: string) => {
    if (!confirm('Are you sure you want to suspend this user?')) return;
    
    const response = await fetch(`/api/admin/users/${userId}/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Policy violation' }),
    });

    if (response.ok) {
      setUsers(prev => prev.map(u => 
        u.id === userId ? { ...u, status: 'suspended' } : u
      ));
    }
  };

  const handleUpdateMarketStatus = async (symbol: string, status: string) => {
    const response = await fetch(`/api/admin/markets/${symbol}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (response.ok) {
      setMarkets(prev => prev.map(m =>
        m.symbol === symbol ? { ...m, status } : m
      ));
    }
  };

  const handleUpdateFees = async (symbol: string, makerFee: number, takerFee: number) => {
    const response = await fetch(`/api/admin/markets/${symbol}/fees`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ makerFee, takerFee }),
    });

    if (response.ok) {
      setMarkets(prev => prev.map(m =>
        m.symbol === symbol ? { ...m, makerFee, takerFee } : m
      ));
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      active: 'bg-green-500/20 text-green-500',
      suspended: 'bg-red-500/20 text-red-500',
      pending: 'bg-yellow-500/20 text-yellow-500',
      trading: 'bg-blue-500/20 text-blue-500',
      halted: 'bg-gray-500/20 text-gray-500',
    };
    return `px-2 py-1 rounded text-xs ${colors[status as keyof typeof colors] || 'bg-gray-500/20'}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 w-64 h-full bg-gray-800 border-r border-gray-700 p-4">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-blue-500">TigerEx Admin</h1>
          <p className="text-sm text-gray-400">Control Panel</p>
        </div>

        <nav className="space-y-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`w-full text-left px-4 py-2 rounded ${
              activeTab === 'users' ? 'bg-blue-500' : 'hover:bg-gray-700'
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`w-full text-left px-4 py-2 rounded ${
              activeTab === 'orders' ? 'bg-blue-500' : 'hover:bg-gray-700'
            }`}
          >
            Orders
          </button>
          <button
            onClick={() => setActiveTab('markets')}
            className={`w-full text-left px-4 py-2 rounded ${
              activeTab === 'markets' ? 'bg-blue-500' : 'hover:bg-gray-700'
            }`}
          >
            Markets
          </button>
          <button
            onClick={() => setActiveTab('withdrawals')}
            className={`w-full text-left px-4 py-2 rounded ${
              activeTab === 'withdrawals' ? 'bg-blue-500' : 'hover:bg-gray-700'
            }`}
          >
            Withdrawals
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`w-full text-left px-4 py-2 rounded ${
              activeTab === 'audit' ? 'bg-blue-500' : 'hover:bg-gray-700'
            }`}
          >
            Audit Log
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="ml-64 p-6">
        <h1 className="text-2xl font-bold mb-6 capitalize">{activeTab}</h1>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            {/* Users Table */}
            {activeTab === 'users' && (
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">KYC Level</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Country</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Last Login</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-700/50">
                      <td className="px-4 py-3">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-500 rounded text-xs">
                          Level {user.kycLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(user.status)}
                      </td>
                      <td className="px-4 py-3">{user.country}</td>
                      <td className="px-4 py-3 text-gray-400 text-sm">
                        {formatDate(user.lastLogin)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleSuspendUser(user.id)}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          Suspend
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* Orders Table */}
            {activeTab === 'orders' && (
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Order ID</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Symbol</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Side</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Price</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Qty</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Filled</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-mono text-sm">{order.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-sm">{order.userId.slice(0, 8)}</td>
                      <td className="px-4 py-3">{order.symbol}</td>
                      <td className={`px-4 py-3 ${order.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                        {order.side.toUpperCase()}
                      </td>
                      <td className="px-4 py-3">${order.price.toLocaleString()}</td>
                      <td className="px-4 py-3">{order.quantity}</td>
                      <td className="px-4 py-3">{order.filled}/{order.quantity}</td>
                      <td className="px-4 py-3">{getStatusBadge(order.status)}</td>
                      <td className="px-4 py-3 text-gray-400 text-sm">{formatDate(order.createdAt)}</td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                        No orders found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* Markets Table */}
            {activeTab === 'markets' && (
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Symbol</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Maker Fee</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Taker Fee</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {markets.map(market => (
                    <tr key={market.symbol} className="hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-medium">{market.symbol}</td>
                      <td className="px-4 py-3">{getStatusBadge(market.status)}</td>
                      <td className="px-4 py-3">{(market.makerFee * 100).toFixed(2)}%</td>
                      <td className="px-4 py-3">{(market.takerFee * 100).toFixed(2)}%</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <select
                            value={market.status}
                            onChange={(e) => handleUpdateMarketStatus(market.symbol, e.target.value)}
                            className="bg-gray-700 px-2 py-1 rounded text-sm"
                          >
                            <option value="trading">Trading</option>
                            <option value="halted">Halted</option>
                            <option value="maintenance">Maintenance</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {markets.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        No markets found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* Withdrawals Placeholder */}
            {activeTab === 'withdrawals' && (
              <div className="p-8 text-center text-gray-400">
                Withdrawal queue management - coming soon
              </div>
            )}

            {/* Audit Log Placeholder */}
            {activeTab === 'audit' && (
              <div className="p-8 text-center text-gray-400">
                Audit log viewer - coming soon
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;