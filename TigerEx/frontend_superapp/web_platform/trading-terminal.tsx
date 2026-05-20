// Trading terminal exports - see components folder for implementations
export * from './components/';
//# source file exports below, actual components created inline

// Core types
export type Order = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET' | 'STOP_LIMIT';
  price: number;
  quantity: number;
  filled: number;
  status: string;
  createdAt: string;
};

// Widget wrapper for embedding
export class TradingTerminalWidget {
  constructor(container: HTMLElement, config: { symbol: string }) {
    // Initialize trading terminal
  }
}

// Styles - to be used with Tailwind CSS
export const styles = `
.trading-terminal {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --border-color: #334155;
  --green-500: #22c55e;
  --red-500: #ef4444;
}

.order-form {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
}

.side-toggle {
  display: flex;
  gap: 8px;
}

.side-toggle button {
  flex: 1;
  padding: 12px;
  border-radius: 4px;
  font-weight: 600;
}

.buy-btn { background: var(--bg-secondary); color: var(--green-500); }
.buy-btn.active { background: var(--green-500); color: white; }

.sell-btn { background: var(--bg-secondary); color: var(--red-500); }
.sell-btn.active { background: var(--red-500); color: white; }
`;