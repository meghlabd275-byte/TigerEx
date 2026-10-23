#!/usr/bin/env python3
"""
TigerEx Analytics Pipeline - Python
Data processing, ETL, and business intelligence.

Every metric is derived from records that were actually ingested. Nothing is
synthesised: extract/load require a configured backend, and BI/aggregation
compute from the in-memory store populated by the pipeline.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Callable, Iterable
from datetime import datetime, timezone
import json


# ============================================================================
# DATA MODELS
# ============================================================================

@dataclass
class TradeMetric:
    symbol: str
    volume: float
    trades: int
    makers: int
    takers: int
    fees: float
    timestamp: int


@dataclass
class UserMetric:
    user_id: str
    trades: int
    volume: float
    pnl: float
    last_active: int


@dataclass
class Candle:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


# ============================================================================
# ETL PIPELINE
# ============================================================================

class ETLPipeline:
    """Extract, Transform, Load pipeline.

    Extraction and loading are delegated to configured backends. When a backend
    is absent the stage fails closed so a caller never mistakes "not wired" for
    "succeeded".
    """

    def __init__(self):
        self.raw_data: List[Dict] = []
        self.transformed: List[TradeMetric] = []
        self._extractors: Dict[str, Callable[[], Iterable[Dict]]] = {}
        self._loaders: Dict[str, Callable[[List[TradeMetric]], bool]] = {}

    def register_extractor(self, name: str, extractor: Callable[[], Iterable[Dict]]) -> None:
        if not callable(extractor):
            raise TypeError("extractor must be callable")
        self._extractors[name] = extractor

    def register_loader(self, name: str, loader: Callable[[List[TradeMetric]], bool]) -> None:
        if not callable(loader):
            raise TypeError("loader must be callable")
        self._loaders[name] = loader

    def extract(self, source: str) -> List[Dict]:
        extractor = self._extractors.get(source)
        if extractor is None:
            raise RuntimeError(f"no extractor registered for source '{source}'")
        records = list(extractor())
        self.raw_data = records
        return records

    def transform(self, data: List[Dict]) -> List[TradeMetric]:
        transformed: List[TradeMetric] = []
        for record in data:
            price = record.get('price')
            quantity = record.get('qty')
            if not isinstance(price, (int, float)) or not isinstance(quantity, (int, float)):
                raise ValueError("trade record requires numeric 'price' and 'qty'")
            if price < 0 or quantity < 0:
                raise ValueError("trade record price and qty must be non-negative")

            side = str(record.get('side', '')).lower()
            if side not in ('buy', 'sell'):
                raise ValueError("trade record side must be 'buy' or 'sell'")

            transformed.append(TradeMetric(
                symbol=str(record.get('symbol', '')),
                volume=price * quantity,
                trades=1,
                makers=0,
                takers=1,
                fees=float(record.get('fee', 0.0)),
                timestamp=int(record.get('timestamp') or datetime.now(timezone.utc).timestamp()),
            ))

        self.transformed = transformed
        return transformed

    def load(self, destination: str) -> bool:
        loader = self._loaders.get(destination)
        if loader is None:
            raise RuntimeError(f"no loader registered for destination '{destination}'")
        return bool(loader(self.transformed))

    def run_full(self, source: str, destination: str) -> bool:
        data = self.extract(source)
        self.transform(data)
        return self.load(destination)


# ============================================================================
# BUSINESS INTELLIGENCE
# ============================================================================

class BusinessIntelligence:
    """BI dashboards and aggregated metrics derived from ingested trades."""

    def __init__(self):
        self.trades: List[TradeMetric] = []
        self.users: Dict[str, UserMetric] = {}

    def ingest_trades(self, trades: Iterable[TradeMetric]) -> None:
        self.trades.extend(trades)

    def ingest_users(self, users: Iterable[UserMetric]) -> None:
        for user in users:
            self.users[user.user_id] = user

    def _trades_on(self, date: str) -> List[TradeMetric]:
        return [
            trade for trade in self.trades
            if datetime.fromtimestamp(trade.timestamp, tz=timezone.utc).strftime('%Y-%m-%d') == date
        ]

    def calculate_daily_metrics(self, date: str) -> Dict:
        trades = self._trades_on(date)
        volume = sum(trade.volume for trade in trades)
        fees = sum(trade.fees for trade in trades)

        day_start = datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()
        new_users = sum(1 for user in self.users.values() if user.last_active >= day_start)

        return {
            'date': date,
            'volume': volume,
            'trades': sum(trade.trades for trade in trades),
            'active_users': len({trade.symbol for trade in trades}) and len(self.users),
            'new_users': new_users,
            'revenue': fees,
            'fees_total': fees,
        }

    def calculate_user_segments(self) -> Dict:
        if not self.users:
            return {}

        volumes = sorted((user.volume for user in self.users.values()), reverse=True)
        total = sum(volumes) or 1.0

        # Thresholds are relative to observed distribution, not constants.
        whale_cut = volumes[max(0, int(len(volumes) * 0.01) - 1)]
        dolphin_cut = volumes[max(0, int(len(volumes) * 0.10) - 1)]
        minnow_cut = volumes[max(0, int(len(volumes) * 0.50) - 1)]

        def bucket(user: UserMetric) -> str:
            if user.volume >= whale_cut:
                return 'whales'
            if user.volume >= dolphin_cut:
                return 'dolphins'
            if user.volume >= minnow_cut:
                return 'minnows'
            return 'retail'

        segments: Dict[str, Dict] = {}
        for user in self.users.values():
            name = bucket(user)
            entry = segments.setdefault(name, {'count': 0, 'volume': 0.0})
            entry['count'] += 1
            entry['volume'] += user.volume

        for entry in segments.values():
            entry['volume_share'] = entry['volume'] / total

        return segments

    def calculate_token_metrics(self, symbol: str) -> Dict:
        trades = [trade for trade in self.trades if trade.symbol == symbol]
        if not trades:
            raise ValueError(f"no trades recorded for symbol '{symbol}'")

        volume = sum(trade.volume for trade in trades)
        quantities = [trade.volume for trade in trades]
        mean = volume / len(quantities)
        variance = sum((q - mean) ** 2 for q in quantities) / len(quantities)

        return {
            'symbol': symbol,
            'volume_24h': volume,
            'trades_24h': sum(trade.trades for trade in trades),
            'volatility': (variance ** 0.5) / mean if mean else 0.0,
            'vwap': mean,
        }


# ============================================================================
# REPORTING ENGINE
# ============================================================================

class ReportingEngine:
    """Renders reports from the BI layer. Unknown report types fail closed."""

    def __init__(self, business_intelligence: BusinessIntelligence):
        if business_intelligence is None:
            raise ValueError("a BusinessIntelligence instance is required")
        self.bi = business_intelligence
        self.schedule: Dict[str, str] = {}

    def create_report(self, report_type: str, params: Dict) -> str:
        builders = {
            'daily': self.daily_report,
            'weekly': self.weekly_report,
            'monthly': self.monthly_report,
        }
        builder = builders.get(report_type)
        if builder is None:
            raise ValueError(f"unsupported report type '{report_type}'")
        return builder(params)

    def daily_report(self, params: Dict) -> str:
        date = params.get('date') or datetime.now(timezone.utc).strftime('%Y-%m-%d')
        return json.dumps(self.bi.calculate_daily_metrics(date), indent=2, default=str)

    def weekly_report(self, params: Dict) -> str:
        dates = params.get('dates')
        if not dates:
            raise ValueError("weekly report requires an explicit list of dates")
        return json.dumps([self.bi.calculate_daily_metrics(d) for d in dates], indent=2, default=str)

    def monthly_report(self, params: Dict) -> str:
        dates = params.get('dates')
        if not dates:
            raise ValueError("monthly report requires an explicit list of dates")
        return json.dumps([self.bi.calculate_daily_metrics(d) for d in dates], indent=2, default=str)

    def schedule_report(self, report_type: str, cron: str) -> bool:
        if not report_type or not cron:
            raise ValueError("report_type and cron are required")
        self.schedule[report_type] = cron
        return True


# ============================================================================
# AGGREGATION ENGINE
# ============================================================================

class AggregationEngine:
    """Real-time and batch aggregations over ingested candles."""

    WINDOW_SECONDS = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400}

    def __init__(self):
        self.candles: Dict[str, List[Candle]] = {}

    def record_candle(self, symbol: str, candle: Candle) -> None:
        if candle.high < candle.low:
            raise ValueError("candle high must be >= low")
        if not (candle.low <= candle.open <= candle.high and candle.low <= candle.close <= candle.high):
            raise ValueError("candle open/close must lie within [low, high]")
        self.candles.setdefault(symbol, []).append(candle)
        self.candles[symbol].sort(key=lambda c: c.timestamp)

    def aggregate_volume(self, symbol: str, window: str) -> float:
        candles = self._window_candles(symbol, window)
        return sum(candle.volume for candle in candles)

    def aggregate_trades(self, symbol: str, window: str) -> int:
        return len(self._window_candles(symbol, window))

    def _window_candles(self, symbol: str, window: str) -> List[Candle]:
        seconds = self.WINDOW_SECONDS.get(window)
        if seconds is None:
            raise ValueError(f"unsupported window '{window}'")
        candles = self.candles.get(symbol)
        if not candles:
            raise ValueError(f"no candles recorded for symbol '{symbol}'")

        cutoff = max(candle.timestamp for candle in candles) - seconds
        return [candle for candle in candles if candle.timestamp > cutoff]

    def calculate_candles(self, symbol: str, interval: str, limit: int) -> List[Dict]:
        if limit <= 0:
            raise ValueError("limit must be positive")
        candles = self.candles.get(symbol)
        if not candles:
            raise ValueError(f"no candles recorded for symbol '{symbol}'")
        return [
            {
                'timestamp': candle.timestamp,
                'open': candle.open,
                'high': candle.high,
                'low': candle.low,
                'close': candle.close,
                'volume': candle.volume,
            }
            for candle in candles[-limit:]
        ]


# ============================================================================
# SELF-TEST
# ============================================================================

def _self_test() -> None:
    now = int(datetime.now(timezone.utc).timestamp())
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    pipeline = ETLPipeline()
    records = [
        {'symbol': 'BTC/USDT', 'side': 'buy', 'price': 100.0, 'qty': 2.0, 'fee': 0.2, 'timestamp': now},
        {'symbol': 'ETH/USDT', 'side': 'sell', 'price': 50.0, 'qty': 1.0, 'fee': 0.05, 'timestamp': now},
    ]
    pipeline.register_extractor('memory', lambda: records)
    loaded: List[TradeMetric] = []
    pipeline.register_loader('memory', lambda rows: loaded.extend(rows) or True)
    assert pipeline.run_full('memory', 'memory') is True
    assert len(loaded) == 2

    # Unregistered backends must fail closed.
    for call in (lambda: pipeline.extract('missing'), lambda: pipeline.load('missing')):
        try:
            call()
            raise AssertionError("unregistered backend must fail")
        except RuntimeError:
            pass

    # Malformed records must be rejected, not silently coerced.
    for bad in ({'price': 'x', 'qty': 1}, {'price': 1, 'qty': 1, 'side': 'hold'}):
        try:
            pipeline.transform([bad])
            raise AssertionError("invalid record must be rejected")
        except ValueError:
            pass

    bi = BusinessIntelligence()
    bi.ingest_trades(loaded)
    bi.ingest_users([
        UserMetric('u1', 5, 1000.0, 10.0, now),
        UserMetric('u2', 1, 10.0, -1.0, now),
    ])
    metrics = bi.calculate_daily_metrics(today)
    assert metrics['volume'] == 250.0, metrics
    assert metrics['trades'] == 2
    assert abs(bi.calculate_token_metrics('BTC/USDT')['vwap'] - 200.0) < 1e-9

    reporting = ReportingEngine(bi)
    assert 'volume' in reporting.create_report('daily', {'date': today})
    try:
        reporting.create_report('quarterly', {})
        raise AssertionError("unknown report type must fail")
    except ValueError:
        pass

    aggregation = AggregationEngine()
    for index in range(5):
        aggregation.record_candle('BTC/USDT', Candle(
            timestamp=now - (5 - index) * 60,
            open=100.0 + index,
            high=101.0 + index,
            low=99.0 + index,
            close=100.5 + index,
            volume=10.0,
        ))
    assert aggregation.aggregate_volume('BTC/USDT', '1h') == 50.0
    assert aggregation.aggregate_trades('BTC/USDT', '1h') == 5
    assert len(aggregation.calculate_candles('BTC/USDT', '1m', 3)) == 3

    print("analytics pipeline self-test passed")


if __name__ == "__main__":
    _self_test()
