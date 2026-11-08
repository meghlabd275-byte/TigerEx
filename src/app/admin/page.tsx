import Link from 'next/link';
import AdminSessionBar from '@/components/admin/AdminSessionBar';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  Coins,
  CreditCard,
  DollarSign,
  FileText,
  Gauge,
  Gift,
  Landmark,
  Layers,
  LineChart,
  Lock,
  Megaphone,
  Percent,
  Rocket,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Admin console index.
 *
 * The console's sections are separate routes rather than tabs of one page, so
 * this index is the single entry point that links them all. Each entry points
 * at a route that authenticates against `admin_sessions` before it serves
 * anything.
 */

const SECTIONS: Array<{ group: string; items: Array<{ href: string; label: string; description: string; icon: typeof Users }> }> = [
  {
    group: 'Overview',
    items: [
      { href: '/admin/dashboard', label: 'Dashboard', description: 'Exchange statistics and system status', icon: Gauge },
      { href: '/admin/reports', label: 'Reports', description: 'Operational reports', icon: BarChart3 },
      { href: '/admin/audit', label: 'Audit Log', description: 'Append-only trail of every admin action', icon: FileText },
      { href: '/admin/system', label: 'System', description: 'Service health and uptime', icon: Activity },
    ],
  },
  {
    group: 'Accounts',
    items: [
      { href: '/admin/users', label: 'Users', description: 'Accounts, balances, sessions and freezes', icon: Users },
      { href: '/admin/kyc', label: 'KYC Review', description: 'Identity verification queue', icon: ShieldCheck },
      { href: '/admin/permissions', label: 'Permissions', description: 'Admin roles and access', icon: Shield },
      { href: '/admin/api', label: 'API Keys', description: 'Trading API keys and rate limits', icon: Lock },
    ],
  },
  {
    group: 'Markets',
    items: [
      { href: '/admin/pairs', label: 'Spot Markets', description: 'List and delist spot pairs', icon: Layers },
      { href: '/admin/futures', label: 'Futures Markets', description: 'Linear, inverse and dated contracts', icon: LineChart },
      { href: '/admin/perps', label: 'Perpetual Contracts', description: 'Perp listings, funding and leverage', icon: Activity },
      { href: '/admin/margin', label: 'Margin Markets', description: 'Cross and isolated margin pools', icon: Percent },
      { href: '/admin/options', label: 'Options', description: 'Calls and puts with strike and expiry', icon: Sparkles },
      { href: '/admin/etf', label: 'Leveraged Tokens', description: '3x long and short tokens', icon: Coins },
      { href: '/admin/tradfi', label: 'TradFi', description: 'Stocks, forex, commodities and indices', icon: Landmark },
    ],
  },
  {
    group: 'Revenue',
    items: [
      { href: '/admin/fees', label: 'Fees', description: 'Maker, taker and network fee schedules', icon: DollarSign },
      { href: '/admin/revenue', label: 'Revenue', description: 'Fee, interest and liquidation income', icon: BarChart3 },
      { href: '/admin/treasury', label: 'Treasury', description: 'Hot and cold wallet balances', icon: Wallet },
      { href: '/admin/buyback', label: 'Buyback & Burn', description: 'Token buyback and burn schedule', icon: Coins },
    ],
  },
  {
    group: 'Risk',
    items: [
      { href: '/admin/risk', label: 'Risk', description: 'Positions, leverage and liquidation queue', icon: AlertTriangle },
      { href: '/admin/risk-limits', label: 'Risk Limits', description: 'Position tiers per contract', icon: SlidersHorizontal },
      { href: '/admin/insurance', label: 'Insurance Fund', description: 'Per-contract fund and ADL', icon: ShieldCheck },
      { href: '/admin/liquidation', label: 'Liquidation', description: 'Liquidation bots and queue', icon: Activity },
      { href: '/admin/oracle', label: 'Oracle', description: 'Price feeds and deviation guards', icon: Gauge },
      { href: '/admin/pause', label: 'Emergency Pause', description: 'Pause trading per market or exchange-wide', icon: Lock },
    ],
  },
  {
    group: 'Products',
    items: [
      { href: '/admin/earn', label: 'Earn', description: 'Flexible, locked and vault products', icon: Percent },
      { href: '/admin/copy', label: 'Copy Trading', description: 'Leader approval and copy fees', icon: Users },
      { href: '/admin/bots', label: 'Bots', description: 'Grid, DCA and market-maker strategies', icon: Bot },
      { href: '/admin/launchpad', label: 'Launchpad', description: 'Token sales and allocations', icon: Rocket },
      { href: '/admin/p2p', label: 'P2P', description: 'Merchants, ads, escrow and disputes', icon: CreditCard },
      { href: '/admin/pay', label: 'Pay & Card', description: 'Transfers and card issuance', icon: CreditCard },
      { href: '/admin/subaccounts', label: 'Sub-accounts', description: 'Team accounts with isolated balances', icon: Users },
    ],
  },
  {
    group: 'Configuration',
    items: [
      { href: '/admin/settings', label: 'Settings', description: 'Exchange configuration', icon: Settings },
      { href: '/admin/banners', label: 'Banners', description: 'Promotional content', icon: Megaphone },
      { href: '/admin/notifications', label: 'Notifications', description: 'Announcements to users', icon: Bell },
      { href: '/admin/support', label: 'Support', description: 'Tickets and knowledge base', icon: Ticket },
      { href: '/admin/announcements', label: 'Announcements', description: 'Scheduled notices', icon: Megaphone },
      { href: '/admin/white-label', label: 'White Label', description: 'Branding and domains', icon: Gift },
    ],
  },
];

export default function AdminIndexPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">TigerEx Admin</h1>
        <AdminSessionBar />
      </div>
      <p className="mt-1 max-w-3xl text-sm text-gray-500">
        Every section below is backed by the exchange&apos;s own database. Each route authenticates the admin
        session before it serves or changes anything, and every mutation is written to the append-only audit trail.
      </p>

      <div className="mt-6 flex flex-col gap-8">
        {SECTIONS.map((section) => (
          <section key={section.group}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{section.group}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-400 hover:bg-blue-50"
                >
                  <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  <span>
                    <span className="block font-medium text-gray-900">{item.label}</span>
                    <span className="block text-sm text-gray-500">{item.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
