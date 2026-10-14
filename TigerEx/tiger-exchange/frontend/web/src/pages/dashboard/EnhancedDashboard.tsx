import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

interface PortfolioData {
  totalBalance: number;
  totalLocked: number;
  totalValue: number;
  dailyChange: number | null;
  dailyChangePercent: number | null;
}

interface RecentTrade {
  id: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  timestamp: string;
}

export default function EnhancedDashboard() {
  const { user } = useAuth();
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [kycStatus, setKycStatus] = useState<{ kycLevel: number; kycStatus: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        const balanceResponse = await api.get('/api/v1/wallet/balance');
        if (cancelled) return;

        if (balanceResponse.data?.success && Array.isArray(balanceResponse.data.data)) {
          const wallets = balanceResponse.data.data;
          const totalBalance = wallets.reduce((sum: number, wallet: any) => {
            const value = Number(wallet?.balance);
            return sum + (Number.isFinite(value) && value >= 0 ? value : 0);
          }, 0);
          const totalLocked = wallets.reduce((sum: number, wallet: any) => {
            const value = Number(wallet?.locked);
            return sum + (Number.isFinite(value) && value >= 0 ? value : 0);
          }, 0);
          const performance = balanceResponse.data.performance;
          const dailyChange = Number(performance?.dailyChange);
          const dailyChangePercent = Number(performance?.dailyChangePercent);

          setPortfolioData({
            totalBalance,
            totalLocked,
            totalValue: totalBalance + totalLocked,
            dailyChange: performance?.dailyChange != null && Number.isFinite(dailyChange) ? dailyChange : null,
            dailyChangePercent: performance?.dailyChangePercent != null && Number.isFinite(dailyChangePercent) ? dailyChangePercent : null,
          });
        } else {
          setPortfolioData(null);
        }

        // Never invent fills; show an empty state until a real authenticated
        // execution-history endpoint is integrated.
        setRecentTrades([]);

        try {
          const kycResponse = await api.get('/api/v1/kyc/status');
          if (!cancelled) setKycStatus(kycResponse.data?.success ? kycResponse.data.data : null);
        } catch {
          if (!cancelled) setKycStatus(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPortfolioData(null);
          setRecentTrades([]);
          setKycStatus(null);
          console.error('Failed to fetch dashboard data:', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchDashboardData();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-2xl font-semibold">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

        {/* Welcome Section */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg p-6 mb-8">
          <h2 className="text-2xl font-bold mb-2">Welcome back, {user?.email}!</h2>
          <p className="text-blue-100">Track your portfolio and manage your trades</p>
        </div>

        {/* Portfolio Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {portfolioData && (
            <>
              <div className="bg-gray-800 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Total Balance</div>
                <div className="text-3xl font-bold mb-2">${portfolioData.totalBalance.toFixed(2)}</div>
                <div className="text-sm text-gray-400">Available for trading</div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Locked Balance</div>
                <div className="text-3xl font-bold mb-2 text-yellow-400">${portfolioData.totalLocked.toFixed(2)}</div>
                <div className="text-sm text-gray-400">In open orders</div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Total Value</div>
                <div className="text-3xl font-bold mb-2">${portfolioData.totalValue.toFixed(2)}</div>
                <div className={`text-sm ${portfolioData.dailyChangePercent !== null && portfolioData.dailyChangePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {portfolioData.dailyChangePercent === null ? 'Performance unavailable' : `${portfolioData.dailyChangePercent >= 0 ? '+' : ''}${portfolioData.dailyChangePercent.toFixed(2)}% today`}
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-6">
                <div className="text-gray-400 text-sm mb-2">Daily Change</div>
                <div className={`text-3xl font-bold mb-2 ${portfolioData.dailyChange !== null && portfolioData.dailyChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {portfolioData.dailyChange === null ? '—' : `${portfolioData.dailyChange >= 0 ? '+' : ''}${portfolioData.dailyChange.toFixed(2)}`}
                </div>
                <div className="text-sm text-gray-400">24h change</div>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* KYC Status */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">KYC Status</h3>
            {kycStatus ? (
              <div>
                <div className="mb-4">
                  <div className="text-gray-400 text-sm mb-2">Verification Level</div>
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold">{kycStatus.kycLevel}</div>
                    <div className="text-sm text-gray-400">/ 4</div>
                  </div>
                </div>
                <div className="mb-4">
                  <div className="text-gray-400 text-sm mb-2">Status</div>
                  <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                    kycStatus.kycStatus === 'approved' ? 'bg-green-900 text-green-200' :
                    kycStatus.kycStatus === 'pending' ? 'bg-yellow-900 text-yellow-200' :
                    kycStatus.kycStatus === 'rejected' ? 'bg-red-900 text-red-200' :
                    'bg-gray-700 text-gray-200'
                  }`}>
                    {kycStatus.kycStatus.charAt(0).toUpperCase() + kycStatus.kycStatus.slice(1)}
                  </div>
                </div>
                {kycStatus.kycStatus !== 'approved' && (
                  <button className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded-lg font-semibold transition">
                    Complete KYC
                  </button>
                )}
              </div>
            ) : (
              <div className="text-gray-400">Loading KYC status...</div>
            )}
          </div>

          {/* Recent Trades */}
          <div className="lg:col-span-2 bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Trades</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left">Symbol</th>
                    <th className="px-4 py-2 text-left">Side</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Quantity</th>
                    <th className="px-4 py-2 text-left">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.length > 0 ? (
                    recentTrades.map((trade) => (
                      <tr key={trade.id} className="border-t border-gray-700">
                        <td className="px-4 py-2 font-semibold">{trade.symbol}</td>
                        <td className={`px-4 py-2 ${trade.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.side.toUpperCase()}
                        </td>
                        <td className="px-4 py-2 text-right">${trade.price.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right">{trade.quantity.toFixed(8)}</td>
                        <td className="px-4 py-2 text-gray-400">
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-2 text-center text-gray-400">
                        No recent trades
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="/trading" className="bg-blue-600 hover:bg-blue-700 rounded-lg p-4 text-center font-semibold transition">
            Start Trading
          </a>
          <a href="/wallet" className="bg-green-600 hover:bg-green-700 rounded-lg p-4 text-center font-semibold transition">
            Manage Wallet
          </a>
          <a href="/dashboard/profile" className="bg-purple-600 hover:bg-purple-700 rounded-lg p-4 text-center font-semibold transition">
            View Profile
          </a>
        </div>
      </div>
    </div>
  );
}
