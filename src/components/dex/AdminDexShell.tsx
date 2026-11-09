'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';

const NAV: Array<{ name: string; href: string }> = [
  { name: 'Overview', href: '/admin/dex' },
  { name: 'Tokens', href: '/admin/dex/tokens' },
  { name: 'Pools', href: '/admin/dex/pools' },
  { name: 'Farms', href: '/admin/dex/farms' },
  { name: 'Vaults', href: '/admin/dex/vaults' },
  { name: 'Liquid staking', href: '/admin/dex/liquid-staking' },
  { name: 'Perps & funding', href: '/admin/dex/perps' },
  { name: 'Margin markets', href: '/admin/dex/margin' },
  { name: 'Hooks', href: '/admin/dex/hooks' },
  { name: 'Bots', href: '/admin/dex/bots' },
  { name: 'Fees & splits', href: '/admin/dex/fees' },
  { name: 'Users', href: '/admin/dex/users' },
  { name: 'Revenue', href: '/admin/dex/revenue' },
  { name: 'Audit', href: '/admin/dex/audit' },
];

/**
 * Chrome for the TigerSwap administration console.
 *
 * Every page under `/admin/dex` calls a route that authenticates against
 * `admin_sessions` before it serves or changes anything, so this shell only
 * provides navigation and layout.
 */
export function AdminDexShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-gray-50 p-6 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/admin" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            ← Admin
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">TigerSwap admin</h1>
        </div>

        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 pb-2 dark:border-slate-800">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href as Route}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                pathname === item.href
                  ? 'bg-blue-100 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{subtitle}</p>}
        </div>

        {children}
      </div>
    </div>
  );
}

/** A result banner for an admin mutation. */
export function AdminMessage({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p
      className={`mb-4 rounded-md px-3 py-2 text-sm ${
        message.ok
          ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      }`}
    >
      {message.text}
    </p>
  );
}

export function Card({
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
      className={`rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="mb-2">
      <label className="block text-xs text-gray-500 dark:text-slate-400">{label}</label>
      <input
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
