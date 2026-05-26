#!/usr/bin/env python3
"""
TigerEx Social Trading - Python
Copy trading and signal providers
"""

from dataclasses import dataclass
from typing import List, Optional
import json
import time

@dataclass
class Trader:
    id: str
    username: str
    followers: int
    pnl_30d: float
    win_rate: float
    max_drawdown: float
    copy_limit: float
    active: bool

@dataclass
class Follower:
    id: str
    trader_id: str
    allocate: float
    copy_ratio: float
    stop_loss: float

@dataclass
class TradeSignal:
    symbol: str
    side: str  # buy, sell
    entry_price: float
    stop_loss: float
    take_profit: float
    quantity: float

class SocialTrading:
    def __init__(self):
        self.traders: dict = {}
        self.followers: dict = {}
        self.signals: dict = {}
        self.performance: dict = {}
    
    def register_trader(self, username: str, copy_limit: float) -> str:
        trader_id = f"trader_{len(self.traders)}"
        self.traders[trader_id] = Trader(
            id=trader_id,
            username=username,
            followers=0,
            pnl_30d=0,
            win_rate=0,
            max_drawdown=0,
            copy_limit=copy_limit,
            active=True
        )
        return trader_id
    
    def follow_trader(self, user_id: str, trader_id: str, allocate: float, 
                   copy_ratio: float = 1.0, stop_loss: float = 0.1) -> str:
        if trader_id not in self.traders:
            raise ValueError("Trader not found")
        
        trader = self.traders[trader_id]
        if allocate > trader.copy_limit:
            raise ValueError("Exceeds copy limit")
        
        follower_id = f"follower_{len(self.followers)}"
        self.followers[follower_id] = Follower(
            id=follower_id,
            trader_id=trader_id,
            allocate=allocate,
            copy_ratio=copy_ratio,
            stop_loss=stop_loss
        )
        
        trader.followers += 1
        return follower_id
    
    def publish_signal(self, trader_id: str, signal: TradeSignal) -> str:
        sig_id = f"sig_{trader_id}_{int(time.time())}"
        self.signals[sig_id] = signal
        return sig_id
    
    def execute_copy(self, signal: TradeSignal, followers: List[Follower]) -> dict:
        trades = {}
        
        for f in followers:
            if f.copy_ratio <= 0:
                continue
            
            qty = signal.quantity * f.copy_ratio * f.allocate
            trades[f.id] = {
                'symbol': signal.symbol,
                'side': signal.side,
                'quantity': qty,
                'entry': signal.entry_price,
                'stop_loss': signal.stop_loss
            }
        
        return trades
    
    def calculate_performance(self, trader_id: str, pnl: float) -> dict:
        if trader_id not in self.performance:
            self.performance[trader_id] = {'pnl': 0, 'trades': 0, 'wins': 0}
        
        perf = self.performance[trader_id]
        perf['pnl'] += pnl
        perf['trades'] += 1
        if pnl > 0:
            perf['wins'] += 1
        
        perf['win_rate'] = perf['wins'] / perf['trades']
        return perf
    
    def get_top_traders(self, limit: int = 10) -> List[Trader]:
        sorted_traders = sorted(
            self.traders.values(),
            key=lambda t: t.pnl_30d,
            reverse=True
        )
        return sorted_traders[:limit]

class CopyTradingBot:
    def __init__(self, api_key: str, secret: str):
        self.api_key = api_key
        self.social = SocialTrading()
    
    def start_copy(self, trader_id: str, amount: float) -> str:
        return self.social.follow_trader("me", trader_id, amount)
    
    def sync_positions(self, trader_id: str) -> dict:
        follower_ids = [
            f.id for f in self.social.followers.values()
            if f.trader_id == trader_id
        ]
        return {'synced': len(follower_ids)}

def main():
    st = SocialTrading()
    
    tid = st.register_trader("CryptoMaster", 100000)
    print(f"Registered: {tid}")
    
    fid = st.follow_trader("user1", tid, 10000)
    print(f"Following: {fid}")
    
    signal = TradeSignal("BTC/USDT", "buy", 50000, 49000, 52000, 0.1)
    sig_id = st.publish_signal(tid, signal)
    print(f"Signal: {sig_id}")
    
    top = st.get_top_traders()
    print(f"Top traders: {len(top)}")

if __name__ == "__main__":
    main()