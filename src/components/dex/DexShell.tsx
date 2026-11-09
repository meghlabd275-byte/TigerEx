'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV: Array<{ name: string; href: string }> = [
  { name: 'Overview', href: '/dex' },
  { name: 'Swap', href: '/dex/swap' },
  { name: 'Liquidity', href: '/dex/liquidity' },
  { name: 'Farms', href: '/dex/farms' },
  { name: 'veTGR', href: '/dex/veTGR' },
  { name: 'Perps', href: '/dex/perps' },
  { name: 'Margin', href: '/dex/margin' },
  { name: 'Orders', href: '/dex/orders' },
  { name: 'Launchpad', href: '/dex/launchpad' },
  { name: 'NFT', href: '/dex/nft' },
  { name: 'Bridge', href: '/dex/bridge' },
  { name: 'Portfolio', href: '/dex/portfolio' },
];

/**
 * Shared chrome for the TigerSwap views.
 *
 * The navigation lists only routes this app actually serves, so a link never
 * leads to a 404.
 */
export function DexShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <header className="border-b border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dex" className="text-lg font-bold text-orange-600 dark:text-orange-400">
              TigerSwap
            </Link>
            <span className="hidden text-xs text-gray-500 dark:text-slate-400 sm:inline">
              TigerEx decentralized exchange
            </span>
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <ThemeToggle />
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-orange-100 font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}

/** A bordered panel used across the TigerSwap views. */
export function Panel({
  title,
  children,
  actions,
  className = '',
}: {
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A table wrapper with a horizontal scroll on narrow screens. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b border-gray-200 px-3 py-2 font-medium text-gray-500 dark:border-slate-800 dark:text-slate-400 ${
        right ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right = false,
  className = '',
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-gray-100 px-3 py-2 text-gray-800 dark:border-slate-800/60 dark:text-slate-200 ${
        right ? 'text-right' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}
