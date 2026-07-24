'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

// Theme
const lightTheme = {
  mode: 'light' as const,
  colors: {
    primary: '#f97316',
    secondary: '#ea580c',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textSecondary: '#64748b',
    border: '#e2e8f0',
    error: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
};

const darkTheme = {
  mode: 'dark' as const,
  colors: {
    primary: '#f97316',
    secondary: '#fb923c',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    border: '#334155',
    error: '#f87171',
    success: '#4ade80',
    warning: '#fbbf24',
    info: '#60a5fa',
  },
};

type Theme = typeof lightTheme;

// Theme Context
const ThemeContext = React.createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: lightTheme,
  toggleTheme: () => {},
});

const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState(lightTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('tigerex-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setTheme(darkTheme);
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme.mode === 'light' ? darkTheme : lightTheme;
    setTheme(newTheme);
    localStorage.setItem('tigerex-theme', newTheme.mode);
  };

  if (!mounted) return <>{children}</>;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => React.useContext(ThemeContext);

// Icons
const Icon = ({ name, className }: { name: string; className?: string }) => {
  const icons: Record<string, JSX.Element> = {
    home: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
    market: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
    trade: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />,
    wallet: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
    earn: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    futures: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
    p2p: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
    copy: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />,
    grid: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />,
    launchpad: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />,
    nft: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />,
    staking: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
    settings: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
    user: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
    bell: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />,
    search: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
    menu: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />,
    close: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />,
    sun: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />,
    moon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />,
    logout: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />,
  };
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">{icons[name]}</svg>;
};

// Navigation Items
const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: 'home' },
  { name: 'Markets', href: '/markets', icon: 'market' },
  { name: 'Trade', href: '/trade', icon: 'trade' },
  { name: 'Futures', href: '/futures', icon: 'futures' },
  { name: 'P2P', href: '/p2p', icon: 'p2p' },
  { name: 'Copy Trading', href: '/copy-trading', icon: 'copy' },
  { name: 'Grid Trading', href: '/grid-trading', icon: 'grid' },
  { name: 'Earn', href: '/earn', icon: 'earn' },
  { name: 'Launchpad', href: '/launchpad', icon: 'launchpad' },
  { name: 'Staking', href: '/staking', icon: 'staking' },
  { name: 'NFT', href: '/nft', icon: 'nft' },
  { name: 'Wallet', href: '/wallet', icon: 'wallet' },
];

const bottomNavItems = [
  { name: 'Settings', href: '/settings', icon: 'settings' },
  { name: 'Support', href: '/support', icon: 'user' },
];

// Sidebar Component
const Sidebar: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { theme } = useTheme();
  const pathname = usePathname();

  return (
    <aside className={`fixed left-0 top-0 h-full transition-all duration-300 z-40 ${collapsed ? 'w-20' : 'w-64'}`}
      style={{ backgroundColor: theme.colors.surface, borderRight: `1px solid ${theme.colors.border}` }}>
      
      {/* Logo */}
      <div className="h-16 flex items-center justify-center border-b" style={{ borderColor: theme.colors.border }}>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: theme.colors.primary }}>
            T
          </div>
          {!collapsed && <span className="text-xl font-bold" style={{ color: theme.colors.primary }}>TigerEx</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col h-[calc(100%-4rem)]">
        <div className="flex-1 py-4 overflow-y-auto">
          {navItems.map((item) => (
            <Link key={item.name} href={item.href}
              className={`flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-all ${pathname === item.href ? 'font-semibold' : ''}`}
              style={{
                backgroundColor: pathname === item.href ? `${theme.colors.primary}15` : 'transparent',
                color: pathname === item.href ? theme.colors.primary : theme.colors.textSecondary,
              }}>
              <Icon name={item.icon} className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          ))}
        </div>

        {/* Bottom Items */}
        <div className="py-4 border-t" style={{ borderColor: theme.colors.border }}>
          {bottomNavItems.map((item) => (
            <Link key={item.name} href={item.href}
              className="flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-all"
              style={{ color: theme.colors.textSecondary }}>
              <Icon name={item.icon} className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          ))}
        </div>
      </nav>
    </aside>
  );
};

// Header Component
const Header: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = () => {
    localStorage.removeItem('tigerex_access_token');
    localStorage.removeItem('tigerex_refresh_token');
    router.push('/login');
  };

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b sticky top-0 z-30"
      style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border }}>
      
      {/* Left: Menu & Search */}
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="lg:hidden p-2 rounded-lg hover:opacity-80" style={{ color: theme.colors.text }}>
          <Icon name="menu" className="w-6 h-6" />
        </button>
        
        <div className="relative hidden md:block">
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search markets, coins..."
            className="w-80 px-4 py-2 pl-10 rounded-lg outline-none"
            style={{ backgroundColor: theme.colors.background, color: theme.colors.text, border: `1px solid ${theme.colors.border}` }} />
          <Icon name="search" className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: theme.colors.textSecondary }} />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        <button onClick={toggleTheme} className="p-2 rounded-lg hover:opacity-80" style={{ color: theme.colors.text }}>
          {theme.mode === 'light' ? <Icon name="moon" className="w-5 h-5" /> : <Icon name="sun" className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <button className="p-2 rounded-lg hover:opacity-80 relative" style={{ color: theme.colors.text }}>
          <Icon name="bell" className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ backgroundColor: theme.colors.error }} />
        </button>

        {/* User Menu */}
        <div className="flex items-center gap-3 ml-2 pl-4 border-l" style={{ borderColor: theme.colors.border }}>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium" style={{ color: theme.colors.text }}>John Doe</p>
            <p className="text-xs" style={{ color: theme.colors.textSecondary }}>$12,345.67</p>
          </div>
          <button className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold" style={{ backgroundColor: theme.colors.primary }}>
            JD
          </button>
          <button onClick={handleLogout} className="p-2 rounded-lg hover:opacity-80" style={{ color: theme.colors.error }} title="Logout">
            <Icon name="logout" className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};

// Main Layout
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme, mounted } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!mounted) return null;

  return (
    <ThemeProvider>
      <div className="min-h-screen" style={{ backgroundColor: theme.colors.background }}>
        {/* Mobile Sidebar Overlay */}
        {!sidebarCollapsed && (
          <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarCollapsed(true)} />
        )}
        
        {/* Sidebar */}
        <Sidebar collapsed={sidebarCollapsed} />
        
        {/* Main Content */}
        <div className={`transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
          <Header onMenuClick={() => setSidebarCollapsed(!sidebarCollapsed)} />
          
          <main className="p-6">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t dark:border-slate-700 lg:hidden z-30" style={{ borderColor: theme.colors.border }}>
          <div className="flex justify-around py-2">
            {navItems.slice(0, 5).map((item) => (
              <Link key={item.name} href={item.href} className="flex flex-col items-center p-2">
                <Icon name={item.icon} className="w-5 h-5" style={{ color: theme.colors.textSecondary }} />
                <span className="text-xs mt-1" style={{ color: theme.colors.textSecondary }}>{item.name}</span>
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </ThemeProvider>
  );
}
