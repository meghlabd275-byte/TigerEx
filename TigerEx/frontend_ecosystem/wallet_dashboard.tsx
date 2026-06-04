import React, { useState, useEffect } from 'react';

interface Wallet {
  currency: string;
  balance: number;
  availableBalance: number;
  lockedBalance: number;
  usdValue: number;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'trade' | 'transfer';
  currency: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  date: string;
  txHash?: string;
}

export const WalletDashboard: React.FC = () => {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  useEffect(() => {
    fetch('/api/wallets').then(res => res.json()).then(setWallets);
    fetch('/api/transactions').then(res => res.json()).then(setTransactions);
  }, []);

  const totalBalance = wallets.reduce((sum, w) => sum + w.usdValue, 0);

  const handleCopyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
  };

  const handleWithdraw = async () => {
    if (!selectedCurrency || !withdrawAddress || !withdrawAmount) return;

    const response = await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: selectedCurrency,
        address: withdrawAddress,
        amount: parseFloat(withdrawAmount),
      }),
    });

    if (response.ok) {
      setShowWithdrawModal(false);
      setWithdrawAddress('');
      setWithdrawAmount('');
    }
  };

  const formatNumber = (num: number, decimals: number = 8) => {
    return num.toLocaleString('en-US', { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-500';
      case 'pending': return 'text-yellow-500';
      case 'failed': return 'text-red-500';
      default: return 'text-gray-400';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'deposit': return '↓';
      case 'withdrawal': return '↑';
      case 'trade': return '⇄';
      case 'transfer': return '→';
      default: return '•';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Wallet</h1>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-gray-400">Total Balance</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setShowDepositModal(true)}
            className="px-6 py-3 bg-green-500 hover:bg-green-600 rounded-lg font-medium"
          >
            + Deposit
          </button>
          <button
            onClick={() => setShowWithdrawModal(true)}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg font-medium"
          >
            - Withdraw
          </button>
          <button className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium">
            → Transfer
          </button>
        </div>

        {/* Wallet Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {wallets.map(wallet => (
            <div
              key={wallet.currency}
              className="bg-gray-800 rounded-lg p-4 cursor-pointer hover:bg-gray-750"
              onClick={() => setSelectedCurrency(wallet.currency)}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-lg font-bold">
                    {wallet.currency.charAt(0)}
                  </div>
                  <div>
                    <div className="font-medium">{wallet.currency}</div>
                    <div className="text-sm text-gray-400">Available</div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Balance</span>
                  <span className="font-medium">{formatNumber(wallet.balance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Available</span>
                  <span className="text-green-500">{formatNumber(wallet.availableBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Locked</span>
                  <span className="text-yellow-500">{formatNumber(wallet.lockedBalance)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-700">
                  <span className="text-gray-400">USD Value</span>
                  <span className="font-medium">${wallet.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Transaction History */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-medium mb-4">Transaction History</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Currency</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Date</th>
                  <th className="pb-3">TxHash</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3">
                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${
                        tx.type === 'deposit' ? 'bg-green-500/20 text-green-500' :
                        tx.type === 'withdrawal' ? 'bg-red-500/20 text-red-500' :
                        'bg-blue-500/20 text-blue-500'
                      }`}>
                        {getTypeIcon(tx.type)}
                      </span>
                    </td>
                    <td className="py-3">{tx.currency}</td>
                    <td className={`py-3 font-medium ${tx.type === 'deposit' ? 'text-green-500' : 'text-red-500'}`}>
                      {tx.type === 'deposit' ? '+' : '-'}{formatNumber(tx.amount)}
                    </td>
                    <td className={`py-3 ${getStatusColor(tx.status)}`}>
                      {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </td>
                    <td className="py-3 text-gray-400">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      {tx.txHash ? (
                        <span className="text-blue-400 cursor-pointer hover:underline">
                          {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                        </span>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {transactions.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              No transactions yet
            </div>
          )}
        </div>
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Deposit Cryptocurrency</h2>
            
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Select Currency</label>
              <select className="w-full bg-gray-700 rounded px-3 py-2">
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="USDT">Tether (USDT)</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Network</label>
              <select className="w-full bg-gray-700 rounded px-3 py-2">
                <option value="btc">Bitcoin (BTC)</option>
                <option value="eth">Ethereum (ERC-20)</option>
              </select>
            </div>

            <div className="mb-4 p-4 bg-gray-700 rounded-lg">
              <label className="block text-sm text-gray-400 mb-2">Deposit Address</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-800 px-3 py-2 rounded text-sm break-all">
                  bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
                </code>
                <button 
                  onClick={() => handleCopyAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')}
                  className="px-3 py-2 bg-blue-500 rounded text-sm hover:bg-blue-600"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="mb-4 p-4 bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Or scan QR code</span>
              </div>
              <div className="w-32 h-32 bg-white rounded mx-auto"></div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowDepositModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
              >
                Close
              </button>
              <button 
                onClick={() => setShowDepositModal(false)}
                className="flex-1 px-4 py-2 bg-green-500 rounded hover:bg-green-600"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Withdraw Cryptocurrency</h2>
            
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Select Currency</label>
              <select className="w-full bg-gray-700 rounded px-3 py-2">
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="USDT">Tether (USDT)</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Network</label>
              <select className="w-full bg-gray-700 rounded px-3 py-2">
                <option value="btc">Bitcoin (BTC)</option>
                <option value="eth">Ethereum (ERC-20)</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Recipient Address</label>
              <input
                type="text"
                value={withdrawAddress}
                onChange={(e) => setWithdrawAddress(e.target.value)}
                placeholder="Enter wallet address"
                className="w-full bg-gray-700 rounded px-3 py-2"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Amount</label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-700 rounded px-3 py-2"
              />
            </div>

            <div className="mb-4 p-4 bg-gray-700 rounded-lg text-sm">
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Network Fee</span>
                <span>0.0001 BTC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">You will receive</span>
                <span className="font-medium">-</span>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowWithdrawModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleWithdraw}
                className="flex-1 px-4 py-2 bg-blue-500 rounded hover:bg-blue-600"
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletDashboard;