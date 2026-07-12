'use client';

import React, { useState, useEffect } from 'react';

interface WithdrawModalProps {
  currency?: string;
  onClose?: () => void;
}

export function WithdrawModal({ currency = 'BTC', onClose }: WithdrawModalProps) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState('BTC');
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [balance, setBalance] = useState(0);
  const [fee, setFee] = useState(0);

  // Get available balance
  useEffect(() => {
    const fetchBalance = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) return;

      try {
        const res = await fetch('/api/wallet/balances', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.data) {
          const wallet = data.data.find((w: any) => w.currency === currency);
          if (wallet) {
            setBalance(wallet.available);
          }
        }
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      }
    };

    fetchBalance();
  }, [currency]);

  // Update network when currency changes
  useEffect(() => {
    const defaultNetworks: { [key: string]: string } = {
      'BTC': 'BTC',
      'ETH': 'ERC20',
      'USDT': 'ERC20',
      'BNB': 'BEP20',
      'SOL': 'SOL',
    };
    setNetwork(defaultNetworks[currency] || 'DEFAULT');
  }, [currency]);

  // Calculate fee (mock)
  useEffect(() => {
    const fees: { [key: string]: number } = {
      'BTC': 0.0001,
      'ETH': 0.001,
      'USDT': 1,
      'BNB': 0.001,
      'SOL': 0.01,
    };
    setFee(fees[currency] || 0.01);
  }, [currency]);

  const handleMax = () => {
    const maxAmount = Math.max(0, balance - fee);
    setAmount(maxAmount.toFixed(8));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const token = localStorage.getItem('tigerex_token');
    if (!token) {
      setError('Please login first');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          currency,
          network,
          address,
          amount: parseFloat(amount),
          memo: memo || undefined,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Withdrawal failed');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getNetworkOptions = () => {
    const options: { [key: string]: string[] } = {
      'BTC': ['BTC'],
      'ETH': ['ERC20', 'BEP20'],
      'USDT': ['ERC20', 'BEP20', 'TRC20'],
      'BNB': ['BEP20', 'BEP2'],
      'SOL': ['SOL'],
    };
    return options[currency] || ['DEFAULT'];
  };

  if (success) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 text-center">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">✓</span>
        </div>
        <h3 className="text-white text-xl font-semibold mb-2">Withdrawal Submitted</h3>
        <p className="text-gray-400 mb-4">
          Your withdrawal request has been submitted and is being processed.
        </p>
        <button
          onClick={onClose}
          className="bg-tiger-orange hover:bg-tiger-orange/80 text-white px-6 py-2 rounded-lg font-medium"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6">
      <h3 className="text-white font-semibold text-lg mb-4">Withdraw {currency}</h3>

      {/* Available Balance */}
      <div className="mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Available</span>
          <span className="text-white">{balance.toFixed(8)} {currency}</span>
        </div>
      </div>

      {/* Network */}
      <div className="mb-4">
        <label className="block text-gray-500 text-sm mb-2">Network</label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white"
        >
          {getNetworkOptions().map((net) => (
            <option key={net} value={net}>{net}</option>
          ))}
        </select>
      </div>

      {/* Address */}
      <div className="mb-4">
        <label className="block text-gray-500 text-sm mb-2">Recipient Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter withdrawal address"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white font-mono text-sm"
        />
      </div>

      {/* Memo (for some networks) */}
      {['TRC20', 'XLM', 'XRP', 'SOL'].includes(network) && (
        <div className="mb-4">
          <label className="block text-gray-500 text-sm mb-2">Memo (Required)</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Enter memo"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white font-mono text-sm"
          />
        </div>
      )}

      {/* Amount */}
      <div className="mb-4">
        <label className="block text-gray-500 text-sm mb-2">Amount</label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white pr-16"
          />
          <button
            type="button"
            onClick={handleMax}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-tiger-orange text-sm hover:underline"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Fee & Received */}
      <div className="mb-4 bg-gray-800 rounded-lg p-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">Network Fee</span>
          <span className="text-white">{fee} {currency}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">You will receive</span>
          <span className="text-white">
            {Math.max(0, (parseFloat(amount) || 0) - fee).toFixed(8)} {currency}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-red-500 text-sm bg-red-500/10 p-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading || !address || !amount || parseFloat(amount) <= fee}
        className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
      >
        {loading ? 'Processing...' : `Withdraw ${currency}`}
      </button>
    </div>
  );
}

export default WithdrawModal;
