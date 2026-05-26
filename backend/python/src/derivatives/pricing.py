#!/usr/bin/env python3
"""TigerEx Derivatives Pricing"""

import math
from dataclasses import dataclass

@dataclass
class BlackScholes:
    r: float = 0.05
    
    def cdf(self, x):
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))
    
    def pdf(self, x):
        return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)
    
    def d(self, S, K, T, sigma):
        if T <= 0: return 0
        return (math.log(S/K) + (self.r + 0.5*sigma**2)*T) / (sigma*math.sqrt(T))
    
    def call(self, S, K, T, sigma):
        if T <= 0: return max(S - K, 0)
        d1, d2 = self.d(S,K,T,sigma), self.d(S,K,T,sigma) - sigma*math.sqrt(T)
        return S*self.cdf(d1) - K*math.exp(-self.r*T)*self.cdf(d2)
    
    def put(self, S, K, T, sigma):
        if T <= 0: return max(K - S, 0)
        d1, d2 = self.d(S,K,T,sigma), self.d(S,K,T,sigma) - sigma*math.sqrt(T)
        return K*math.exp(-self.r*T)*self.cdf(-d2) - S*self.cdf(-d1)
    
    def greeks(self, S, K, T, sigma):
        d1 = self.d(S,K,T,sigma)
        d2 = d1 - sigma*math.sqrt(T)
        nd = self.pdf(d1)
        return {
            'delta': self.cdf(d1),
            'gamma': nd/(S*sigma*math.sqrt(T)),
            'vega': S*nd*math.sqrt(T)/100,
            'theta': (-S*nd*sigma/(2*math.sqrt(T)) - self.r*K*math.exp(-self.r*T)*self.cdf(d2))
        }

class PerpPricing:
    def liq_price(self, entry, side, lev):
        m = 0.005
        return entry*(1 - 1/lev + m) if side=='long' else entry*(1 + 1/lev - m)

def main():
    bs = BlackScholes()
    print(f"BTC Call: ${bs.call(50000, 50000, 30/365, 0.8):.2f}")
    print(f"BTC Put: ${bs.put(50000, 50000, 30/365, 0.8):.2f}")
    g = bs.greeks(50000, 50000, 30/365, 0.8)
    print(f"Delta: {g['delta']:.4f} Gamma: {g['gamma']:.6f}")
    p = PerpPricing()
    print(f"Long Liq: ${p.liq_price(50000,'long',10):.2f}")

if __name__ == "__main__":
    main()