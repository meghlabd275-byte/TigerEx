import Link from 'next/link';
import { authFeatures, userTradingFeatures, walletFeatures } from '@/lib/userFeatures';

const grouped = userTradingFeatures.reduce<Record<string, typeof userTradingFeatures>>((acc, feature) => {
  acc[feature.category] = [...(acc[feature.category] || []), feature];
  return acc;
}, {});

export default function UserFeaturesPage() {
  return (
    <main className="min-h-screen bg-[#0a0a14] px-4 py-8 text-white">
      <section className="mx-auto max-w-7xl space-y-8">
        <div className="rounded-3xl border border-orange-500/30 bg-gradient-to-br from-orange-500/20 to-white/5 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">User / Trader Workspace</p>
          <h1 className="mt-3 text-4xl font-bold">Full trader control without admin access</h1>
          <p className="mt-4 max-w-3xl text-gray-300">
            TigerEx exposes the complete operational user suite: markets, spot, margin, futures, options, P2P,
            TradFi, DeFi, ETF, wallet, rewards and authentication. Admin-only surfaces remain outside this workspace.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-green-500/20 px-4 py-2 text-green-300">{userTradingFeatures.length} trading modules</span>
            <span className="rounded-full bg-blue-500/20 px-4 py-2 text-blue-300">{walletFeatures.length} wallet capabilities</span>
            <span className="rounded-full bg-purple-500/20 px-4 py-2 text-purple-300">{authFeatures.length} auth capabilities</span>
          </div>
        </div>

        {Object.entries(grouped).map(([category, features]) => (
          <section key={category}>
            <h2 className="mb-4 text-2xl font-semibold">{category}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <Link key={feature.name} href={feature.route} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-orange-400/60 hover:bg-white/[0.08]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">{feature.name}</h3>
                      <p className="mt-2 text-sm text-gray-400">{feature.capability}</p>
                    </div>
                    <span className="rounded-full bg-green-500/15 px-2 py-1 text-xs text-green-300">{feature.status}</span>
                  </div>
                  <ul className="mt-4 grid gap-2 text-sm text-gray-300">
                    {feature.actions.map((action) => <li key={action}>✓ {action}</li>)}
                  </ul>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className="grid gap-4 md:grid-cols-2">
          {[['Wallet operations', walletFeatures], ['Authentication operations', authFeatures]].map(([title, items]) => (
            <div key={title as string} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <h2 className="text-xl font-semibold">{title as string}</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {(items as string[]).map((item) => <span key={item} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-gray-200">{item}</span>)}
              </div>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}
