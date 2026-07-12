'use client';

import React, { useState, useEffect } from 'react';

interface DepositAddress {
  address: string;
  currency: string;
  network: string;
  memo?: string;
}

interface DepositModalProps {
  currency?: string;
  network?: string;
  onClose?: () => void;
}

export function DepositModal({ currency = 'BTC', network = 'BTC', onClose }: DepositModalProps) {
  const [address, setAddress] = useState<DepositAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchAddress = async () => {
      const token = localStorage.getItem('tigerex_token');
      if (!token) {
        setError('Please login first');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/wallet/address?currency=${currency}&network=${network}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && data.data) {
          setAddress(data.data);
          setError(null);
        } else {
          setError(data.error?.message || 'Failed to get address');
        }
      } catch (err) {
        setError('Failed to connect to server');
      } finally {
        setLoading(false);
      }
    };

    fetchAddress();
  }, [currency, network]);

  const copyToClipboard = async () => {
    if (!address?.address) return;
    
    try {
      await navigator.clipboard.writeText(address.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getNetworkLabel = (net: string) => {
    const labels: { [key: string]: string } = {
      'BTC': 'Bitcoin',
      'ETH': 'Ethereum',
      'ERC20': 'Ethereum (ERC20)',
      'BEP20': 'Binance Smart Chain (BEP20)',
      'TRC20': 'Tron (TRC20)',
      'SOL': 'Solana',
    };
    return labels[net] || net;
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-800 rounded w-1/4" />
          <div className="h-20 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 text-center">
        <span className="text-red-500">{error}</span>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white font-semibold text-lg">Deposit {currency}</h3>
          <p className="text-gray-500 text-sm">{getNetworkLabel(network)}</p>
        </div>
      </div>

      {/* QR Code Placeholder */}
      <div className="flex justify-center mb-6">
        <div className="w-48 h-48 bg-white rounded-lg flex items-center justify-center">
          <div className="text-gray-400 text-center">
            <div className="text-4xl mb-2">📱</div>
            <div className="text-xs">QR Code</div>
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="mb-4">
        <label className="block text-gray-500 text-sm mb-2">Deposit Address</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={address?.address || ''}
            readOnly
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white text-sm font-mono break-all"
          />
          <button
            onClick={copyToClipboard}
            className="bg-tiger-orange hover:bg-tiger-orange/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Memo */}
      {address?.memo && (
        <div className="mb-4">
          <label className="block text-gray-500 text-sm mb-2">Memo (Tag)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={address.memo}
              readOnly
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 text-white text-sm font-mono"
            />
            <button
              onClick={() => navigator.clipboard.writeText(address.memo || '')}
              className="bg-tiger-orange hover:bg-tiger-orange/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Notice */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-4">
        <div className="text-blue-400 text-sm">
          <p className="font-medium mb-1">Important Notice</p>
          <ul className="list-disc list-inside space-y-1 text-gray-400">
            <li>Only send {currency} to this address</li>
            <li>Do not send other tokens to this address</li>
            <li>Minimum deposit: 0.0001 {currency}</li>
            <li>Deposits require network confirmations</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default DepositModal;
