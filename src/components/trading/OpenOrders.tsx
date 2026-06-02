'use client';

import { useState } from 'react';
import { Trash2, Edit2, Copy, Clock, ChevronDown, Search, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

// Order type definitions
type OrderType = 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'take_profit' | 'trailing_stop' | 'oco';
type OrderSide = 'buy' | 'sell';
type OrderStatus = 'new' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'pending';

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
  side: OrderSide;
  type: OrderType;
  price: number;
  stopPrice?: number;
  quantity: number;
  filledQuantity: number;
  remaining: number;
  status: OrderStatus;
  timeInForce: string;
  createdAt: number;
  triggerCondition?: string;
  avgFillPrice?: number;
  postOnly?: boolean;
  reduceOnly?: boolean;
}

// Demo data with comprehensive orders
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
    postOnly: true,
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
    avgFillPrice: 3498.50,
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
    triggerCondition: 'Last Price <= 140.00',
  },
  {
    orderId: 'ORD_20240615004',
    symbol: 'BTC/USDT',
    side: 'sell',
    type: 'take_profit',
    price: 70000,
    stopPrice: 69500,
    quantity: 0.3,
    filledQuantity: 0,
    remaining: 0.3,
    status: 'new',
    timeInForce: 'GTC',
    createdAt: Date.now() - 900000,
    triggerCondition: 'Last Price >= 69500.00',
  },
  {
    orderId: 'ORD_20240615005',
    symbol: 'BNB/USDT',
    side: 'buy',
    type: 'trailing_stop',
    price: 0,
    stopPrice: 550,
    quantity: 5,
    filledQuantity: 0,
    remaining: 5,
    status: 'new',
    timeInForce: 'GTC',
    createdAt: Date.now() - 600000,
    triggerCondition: 'Trail: 3%',
  },
  {
    orderId: 'ORD_20240615006',
    symbol: 'AVAX/USDT',
    side: 'sell',
    type: 'limit',
    price: 38.50,
    quantity: 50,
    filledQuantity: 25,
    remaining: 25,
    status: 'partially_filled',
    timeInForce: 'IOC',
    createdAt: Date.now() - 1200000,
    avgFillPrice: 38.45,
    reduceOnly: true,
  },
];

interface OpenOrdersProps {
  orders?: OpenOrder[];
  onCancel?: (orderId: string) => void;
  onCancelAll?: () => void;
  symbol?: string;
  onModifyOrder?: (order: OpenOrder) => void;
}

export function OpenOrders({ 
  orders: propOrders, 
  onCancel, 
  onCancelAll,
  symbol,
  onModifyOrder 
}: OpenOrdersProps) {
  const [orders, setOrders] = useState<OpenOrder[]>(propOrders || mockOrders);
  const [filterSymbol, setFilterSymbol] = useState(symbol || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSide, setFilterSide] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Filter orders
  const filteredOrders = orders.filter(order => {
    if (filterSymbol && order.symbol !== filterSymbol) return false;
    if (searchTerm && !order.symbol.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !order.orderId.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterType !== 'all' && order.type !== filterType) return false;
    if (filterSide !== 'all' && order.side !== filterSide) return false;
    return order.status !== 'filled' && order.status !== 'canceled';
  });

  const handleCancel = (orderId: string) => {
    setLoading(true);
    setTimeout(() => {
      setOrders(prev => prev.map(o => 
        o.orderId === orderId ? { ...o, status: 'canceled' as OrderStatus } : o
      ));
      onCancel?.(orderId);
      setLoading(false);
    }, 500);
  };

  const handleCancelAll = () => {
    setLoading(true);
    setTimeout(() => {
      setOrders(prev => prev.map(o => ({ ...o, status: 'canceled' as OrderStatus })));
      onCancelAll?.();
      setLoading(false);
    }, 1000);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (price: number, decimals: number = 2) => {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const getFillPercent = (order: OpenOrder) => {
    return ((order.filledQuantity / order.quantity) * 100).toFixed(0);
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-white">Open Orders</h3>
          <span className="text-xs text-gray-400 bg-white/10 px-2 py-0.5 rounded-full">
            {filteredOrders.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white/5 border border-white/10 rounded pl-7 pr-2 py-1 text-xs text-white w-28 focus:outline-none focus:border-tiger-orange"
            />
          </div>
          <select
            value={filterSide}
            onChange={(e) => setFilterSide(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
          >
            <option value="all">All Sides</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="limit">Limit</option>
            <option value="market">Market</option>
            <option value="stop_limit">Stop Limit</option>
            <option value="stop_loss">Stop Loss</option>
            <option value="take_profit">Take Profit</option>
            <option value="trailing_stop">Trailing</option>
          </select>
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
      <div className="flex-1 overflow-y-auto max-h-[400px]">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Clock className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No open orders</p>
            <p className="text-xs mt-1">Your pending orders will appear here</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.orderId}
              className="border-b border-white/5 hover:bg-white/5 transition-colors"
            >
              <div 
                className="grid grid-cols-7 gap-2 px-4 py-3 text-sm cursor-pointer"
                onClick={() => setExpandedOrder(expandedOrder === order.orderId ? null : order.orderId)}
              >
                <div className="text-gray-400 text-xs">
                  {formatTime(order.createdAt)}
                </div>
                <div className="font-medium">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${order.side === 'buy' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className={order.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                      {order.side.toUpperCase()}
                    </span>
                    <span className="text-white">{order.symbol}</span>
                  </div>
                </div>
                <div className="text-gray-400 text-xs">
                  <span className="capitalize">{order.type.replace('_', ' ')}</span>
                  {order.stopPrice && <span className="block text-blue-400">@ {formatPrice(order.stopPrice)}</span>}
                </div>
                <div className="text-right text-gray-300">
                  ${formatPrice(order.price)}
                </div>
                <div className="text-right">
                  <div className="text-gray-300">{order.remaining.toFixed(4)}</div>
                  <div className="text-xs text-gray-500">/ {order.quantity.toFixed(4)}</div>
                </div>
                <div className="text-right">
                  <OrderStatusBadge status={order.status} />
                  {order.status === 'partially_filled' && (
                    <div className="text-xs text-gray-500 mt-1">{getFillPercent(order)}%</div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  ) : (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancel(order.orderId);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Cancel Order"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(order.orderId);
                        }}
                        className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
                        title="Copy Order ID"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Details */}
              {expandedOrder === order.orderId && (
                <div className="px-4 pb-3 bg-white/5">
                  <div className="grid grid-cols-4 gap-3 text-xs py-3 border-t border-white/10">
                    <div>
                      <span className="text-gray-500">Order ID</span>
                      <p className="text-white font-mono mt-0.5">{order.orderId}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Time in Force</span>
                      <p className="text-white mt-0.5">{order.timeInForce}</p>
                    </div>
                    {order.avgFillPrice && (
                      <div>
                        <span className="text-gray-500">Avg Fill Price</span>
                        <p className="text-white mt-0.5">${formatPrice(order.avgFillPrice)}</p>
                      </div>
                    )}
                    {order.triggerCondition && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Trigger Condition</span>
                        <p className="text-blue-400 mt-0.5">{order.triggerCondition}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {order.postOnly && (
                      <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">Post Only</span>
                    )}
                    {order.reduceOnly && (
                      <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">Reduce Only</span>
                    )}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button className="flex-1 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded text-white transition-colors">
                      Modify Order
                    </button>
                    <button className="flex-1 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 rounded text-red-400 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {filteredOrders.length} orders
        </span>
        <button
          onClick={handleCancelAll}
          disabled={loading || filteredOrders.length === 0}
          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel All
        </button>
      </div>
    </div>
  );
}