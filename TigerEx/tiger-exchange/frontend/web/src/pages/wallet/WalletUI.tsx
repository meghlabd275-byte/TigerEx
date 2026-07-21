import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

interface Wallet {
  currency: string;
  balance: number;
  locked: number;
}

interface DepositHistory {
  id: string;
  currency: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface WithdrawalHistory {
  id: string;
  currency: string;
  amount: number;
  status: string;
  createdAt: string;
}

export default function WalletUI() {
  const { user } = useAuth();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [depositHistory, setDepositHistory] = useState<DepositHistory[]>([]);
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalHistory[]>([]);
  const [activeTab, setActiveTab] = useState<'balance' | 'deposit' | 'withdraw'>('balance');
  const [selectedCurrency, setSelectedCurrency] = useState('BTC');
  const [depositAddress, setDepositAddress] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch wallet balances
  useEffect(() => {
    const fetchWallets = async () => {
      try {
        const response = await api.get('/api/v1/wallet/balance');
        if (response.data.success) {
          setWallets(response.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch wallets:', err);
      }
    };

    fetchWallets();
    const interval = setInterval(fetchWallets, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleGenerateAddress = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/api/v1/wallet/address', {
        currency: selectedCurrency,
        network: 'mainnet',
      });
      if (response.data.success) {
        setDepositAddress(response.data.data.address);
        setSuccess('Deposit address generated successfully');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate address');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.post('/api/v1/wallet/withdrawal', {
        currency: selectedCurrency,
        network: 'mainnet',
        amount: parseFloat(withdrawAmount),
        address: withdrawAddress,
      });
      if (response.data.success) {
        setSuccess('Withdrawal initiated successfully');
        setWithdrawAddress('');
        setWithdrawAmount('');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to initiate withdrawal');
    } finally {
      setLoading(false);
    }
  };

  const selectedWallet = wallets.find(w => w.currency === selectedCurrency);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Wallet Management</h1>

        {error && (
          <div className="bg-red-900 text-red-200 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900 text-green-200 p-4 rounded-lg mb-6">
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Wallet List */}
          <div className="lg:col-span-1 bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">My Wallets</h2>
            <div className="space-y-2">
              {wallets.length > 0 ? (
                wallets.map((wallet) => (
                  <button
                    key={wallet.currency}
                    onClick={() => setSelectedCurrency(wallet.currency)}
                    className={`w-full text-left p-3 rounded-lg transition ${
                      selectedCurrency === wallet.currency
                        ? 'bg-blue-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <div className="font-semibold">{wallet.currency}</div>
                    <div className="text-sm text-gray-300">
                      Balance: {wallet.balance.toFixed(8)}
                    </div>
                    {wallet.locked > 0 && (
                      <div className="text-sm text-yellow-400">
                        Locked: {wallet.locked.toFixed(8)}
                      </div>
                    )}
                  </button>
                ))
              ) : (
                <div className="text-gray-400 text-sm">No wallets available</div>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2 bg-gray-800 rounded-lg p-6">
            {/* Tabs */}
            <div className="flex gap-4 mb-6 border-b border-gray-700">
              <button
                onClick={() => setActiveTab('balance')}
                className={`pb-2 font-semibold transition ${
                  activeTab === 'balance'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Balance
              </button>
              <button
                onClick={() => setActiveTab('deposit')}
                className={`pb-2 font-semibold transition ${
                  activeTab === 'deposit'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Deposit
              </button>
              <button
                onClick={() => setActiveTab('withdraw')}
                className={`pb-2 font-semibold transition ${
                  activeTab === 'withdraw'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                Withdraw
              </button>
            </div>

            {/* Balance Tab */}
            {activeTab === 'balance' && selectedWallet && (
              <div>
                <h3 className="text-lg font-semibold mb-4">{selectedCurrency} Balance</h3>
                <div className="bg-gray-700 rounded-lg p-6 mb-4">
                  <div className="text-gray-400 mb-2">Available Balance</div>
                  <div className="text-4xl font-bold mb-4">
                    {selectedWallet.balance.toFixed(8)} {selectedCurrency}
                  </div>
                  {selectedWallet.locked > 0 && (
                    <div>
                      <div className="text-gray-400 mb-2">Locked Balance</div>
                      <div className="text-2xl font-semibold text-yellow-400">
                        {selectedWallet.locked.toFixed(8)} {selectedCurrency}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Deposit Tab */}
            {activeTab === 'deposit' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Deposit {selectedCurrency}</h3>
                <div className="space-y-4">
                  <button
                    onClick={handleGenerateAddress}
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-2 rounded-lg font-semibold transition"
                  >
                    {loading ? 'Generating...' : 'Generate Deposit Address'}
                  </button>
                  
                  {depositAddress && (
                    <div className="bg-gray-700 rounded-lg p-4">
                      <div className="text-gray-400 mb-2">Your Deposit Address</div>
                      <div className="bg-gray-900 p-3 rounded-lg break-all font-mono text-sm">
                        {depositAddress}
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText(depositAddress)}
                        className="mt-3 w-full bg-gray-600 hover:bg-gray-500 py-2 rounded-lg transition"
                      >
                        Copy Address
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Withdraw Tab */}
            {activeTab === 'withdraw' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">Withdraw {selectedCurrency}</h3>
                <form onSubmit={handleWithdraw} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Withdrawal Address</label>
                    <input
                      type="text"
                      value={withdrawAddress}
                      onChange={(e) => setWithdrawAddress(e.target.value)}
                      placeholder="Enter withdrawal address"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Amount</label>
                    <input
                      type="number"
                      step="0.00000001"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Enter amount"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                      required
                    />
                    {selectedWallet && (
                      <div className="text-sm text-gray-400 mt-2">
                        Available: {selectedWallet.balance.toFixed(8)} {selectedCurrency}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 py-2 rounded-lg font-semibold transition"
                  >
                    {loading ? 'Processing...' : 'Withdraw'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
