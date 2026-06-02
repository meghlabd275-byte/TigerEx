'use client';

import { useState } from 'react';
import { Trash2, Edit2, Copy } from 'lucide-react';

// Order status mapping
const OrderStatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    new: 'bg-blue-500/20 text-blue-400',
    partially_filled: 'bg-yellow-500/20 text-yellow-400',
    filled: 'bg-green-500/20 text-green-400',
    canceled: 'bg-gray-500/20 text-gray-400',
    rejected: 'bg-red-500/20 text-red-400',
    pending: 'bg-purple-500/20 text-purple-400',
  };
  
  const labels: Record<string, string> = {
    new: 'Open',
    partially_filled: 'Partial',
    filled: 'Filled',
    canceled: 'Cancelled',
    rejected: 'Rejected',
    pending: 'Pending',
  };
  
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${styles[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {labels[status] || status}
    </span>
  );
};

// Order interface
export interface OpenOrder {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  price: number;
  stopPrice?: number;
  quantity: number;
  filledQuantity: number;
  remaining: number;
  status: string;
  timeInForce: string;
  createdAt: number;
}

// Demo data
const mockOrders: OpenOrder[] = [
  {
    orderId: 'ORD_20240615001',
    symbol: 'BTC/USDT',
    side: 'buy',
    type: 'limit',
    price: 65000,
    quantity: 0.5,
    filledQuantity: 0,
    remaining: 0.5,
    status: 'new',
    timeInForce: 'GTC',
    createdAt: Date.now() - 3600000,
  },
  {
    orderId: 'ORD_20240615002',
    symbol: 'ETH/USDT',
    side: 'sell',
    type: 'limit',
    price: 3500,
    quantity: 2.0,
    filledQuantity: 1.2,
    remaining: 0.8,
    status: 'partially_filled',
    timeInForce: 'GTC',
    createdAt: Date.now() - 7200000,
  },
  {
    orderId: 'ORD_20240615003',
    symbol: 'SOL/USDT',
    side: 'buy',
    type: 'stop_limit',
    price: 145,
    stopPrice: 140,
    quantity: 10,
    filledQuantity: 0,
    remaining: 10,
    status: 'new',
    timeInForce: 'GTT',
    createdAt: Date.now() - 1800000,
  },
];

interface OpenOrdersProps {
  symbol?: string;
  onCancelOrder?: (orderId: string) => void;
  onModifyOrder?: (order: OpenOrder) => void;
}

export function OpenOrders({
  symbol,
  onCancelOrder,
  onModifyOrder,
}: OpenOrdersProps) {
  const [orders, setOrders] = useState<OpenOrder[]>(mockOrders);
  const [filterSymbol, setFilterSymbol] = useState(symbol || '');

  // Filter orders
  const filteredOrders = filterSymbol
    ? orders.filter(o => o.symbol === filterSymbol)
    : orders;

  const handleCancel = (orderId: string) => {
    setOrders(prev => prev.filter(o => o.orderId !== orderId));
    onCancelOrder?.(orderId);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] border border-white/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="font-semibold text-white">Open Orders</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter symbol..."
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white w-24"
          />
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-7 gap-2 px-4 py-2 text-xs text-gray-500 border-b border-white/5">
        <div>Time</div>
        <div>Symbol</div>
        <div>Type</div>
        <div className="text-right">Price</div>
        <div className="text-right">Amount</div>
        <div className="text-right">Filled</div>
        <div className="text-right">Action</div>
      </div>

      {/* Orders */}
      <div className="flex-1 overflow-y-auto">
        {filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            No open orders
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.orderId}
              className="grid grid-cols-7 gap-2 px-4 py-2 text-sm border-b border-white/5 hover:bg-white/5"
            >
              <div className="text-gray-400 text-xs">{formatTime(order.createdAt)}</div>
              <div className="font-medium">
                <span className={order.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {order.side.toUpperCase()}
                </span>{' '}
                <span className="text-white">{order.symbol}</span>
              </div>
              <div className="text-gray-400">
                {order.type}
                {order.stopPrice && ` @ ${order.stopPrice}`}
              </div>
              <div className="text-right text-gray-300">{order.price.toFixed(2)}</div>
              <div className="text-right text-gray-300">
                {order.remaining.toFixed(4)}/{order.quantity.toFixed(4)}
              </div>
              <div className="text-right">
                <OrderStatusBadge status={order.status} />
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => handleCancel(order.orderId)}
                  className="p-1 text-gray-400 hover:text-red-400"
                  title="Cancel Order"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(order.orderId)}
                  className="p-1 text-gray-400 hover:text-white"
                  title="Copy Order ID"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/10 text-xs text-gray-500">
        {filteredOrders.length} orders •{' '}
        <button
          onClick={() => setOrders([])}
          className="text-red-400 hover:underline"
        >
          Cancel All
        </button>
      </div>
    </div>
  );
}