import Link from "next/link";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  Wallet, 
  ArrowRightLeft, 
  Shield, 
  Zap,
  BarChart3,
  Globe,
  Smartphone,
  Users,
  Lock,
  Clock
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
              <span className="text-xl font-bold text-white">T</span>
            </div>
            <span className="text-xl font-bold text-white">TigerEx</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8">
            <Link href="/markets" className="text-sm text-gray-300 hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/trade" className="text-sm text-gray-300 hover:text-white transition-colors">
              Trade
            </Link>
            <Link href="/earn" className="text-sm text-gray-300 hover:text-white transition-colors">
              Earn
            </Link>
            <Link href="/futures" className="text-sm text-gray-300 hover:text-white transition-colors">
              Futures
            </Link>
            <Link href="/nft" className="text-sm text-gray-300 hover:text-white transition-colors">
              NFT
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button variant="ghost" className="text-white">Log In</Button>
            </Link>
            <Link href="/register">
              <Button className="bg-tiger-orange hover:bg-tiger-orange/90">Sign Up</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-tiger-orange/20 via-transparent to-transparent" />
        
        <div className="container relative mx-auto px-4 text-center">
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-white md:text-6xl lg:text-7xl">
            Trade Crypto with
            <span className="block text-tiger-orange">Confidence</span>
          </h1>
          
          <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-400">
            Professional cryptocurrency exchange with lightning-fast execution, 
            advanced trading tools, and enterprise-grade security.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button size="xl" className="bg-tiger-orange hover:bg-tiger-orange/90 animate-pulse-glow">
                Get Started
                <ArrowRightLeft className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/markets">
              <Button size="xl" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                View Markets
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-white">$2.5B+</div>
              <div className="text-sm text-gray-400">Daily Volume</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-white">200+</div>
              <div className="text-sm text-gray-400">Trading Pairs</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-white">99.9%</div>
              <div className="text-sm text-gray-400">Uptime</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-white">0.1s</div>
              <div className="text-sm text-gray-400">Execution</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-white/5">
        <div className="container mx-auto px-4">
          <h2 className="mb-12 text-center text-3xl font-bold text-white">
            Why Choose TigerEx
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: "Lightning Fast",
                desc: "Sub-millisecond order execution with our high-performance matching engine"
              },
              {
                icon: Shield,
                title: "Bank-Grade Security",
                desc: "Multi-layer security with cold storage, 2FA, and real-time threat detection"
              },
              {
                icon: TrendingUp,
                title: "Advanced Trading",
                desc: "Spot, margin, futures, and options with professional charting tools"
              },
              {
                icon: Wallet,
                title: "Multiple Wallets",
                desc: "Support for 200+ cryptocurrencies with unified portfolio management"
              },
              {
                icon: Globe,
                title: "Global Access",
                desc: "Available in 150+ countries with fast fiat on/off ramps"
              },
              {
                icon: Smartphone,
                title: "Mobile Trading",
                desc: "iOS and Android apps with full trading functionality"
              }
            ].map((feature, idx) => (
              <div 
                key={idx}
                className="group p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
              >
                <feature.icon className="mb-4 h-10 w-10 text-tiger-orange" />
                <h3 className="mb-2 text-xl font-semibold text-white">{feature.title}</h3>
                <p className="text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-6 text-3xl font-bold text-white">
            Ready to Start Trading?
          </h2>
          <p className="mb-8 text-gray-400">
            Join millions of traders on TigerEx today
          </p>
          <Link href="/register">
            <Button size="xl" className="bg-tiger-orange hover:bg-tiger-orange/90">
              Create Free Account
              <ArrowRightLeft className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-black/20 py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-tiger-orange">
                  <span className="text-sm font-bold text-white">T</span>
                </div>
                <span className="text-lg font-bold text-white">TigerEx</span>
              </div>
              <p className="text-sm text-gray-400">
                Professional cryptocurrency exchange
              </p>
            </div>
            
            <div>
              <h4 className="mb-4 font-semibold text-white">Exchange</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/markets" className="hover:text-white">Markets</Link></li>
                <li><Link href="/fees" className="hover:text-white">Fees</Link></li>
                <li><Link href="/api" className="hover:text-white">API</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="mb-4 font-semibold text-white">Support</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/help" className="hover:text-white">Help Center</Link></li>
                <li><Link href="/fees" className="hover:text-white">Trading Fees</Link></li>
                <li><Link href="/verification" className="hover:text-white">Verification</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="mb-4 font-semibold text-white">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/terms" className="hover:text-white">Terms</Link></li>
                <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
                <li><Link href="/security" className="hover:text-white">Security</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="mt-8 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              © 2026 TigerEx. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <Lock className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-500">Secured by enterprise-grade encryption</span>
              <Clock className="h-4 w-4 text-gray-500 ml-4" />
              <span className="text-sm text-gray-500">24/7 Support</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}