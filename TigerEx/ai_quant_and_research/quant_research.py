"""
TigerEx Python AI & Quant Research Infrastructure

LANGUAGE: Python

USES:
- Quantitative research
- AI/ML models
- Fraud detection
- Market prediction
- Backtesting
- LLM infrastructure
- Vector search
- Feature stores
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from enum import Enum
import hashlib
import time

# ========================================================================
# QUANTITATIVE RESEARCH MODELS
# ========================================================================

class MarketRegime(Enum):
    BULL = "bull"
    BEAR = "bear"
    SIDEWAYS = "sideways"
    HIGH_VOLATILITY = "high_volatility"
    LOW_VOLATILITY = "low_volatility"

@dataclass
class Signal:
    symbol: str
    direction: int  # 1 = long, -1 = short, 0 = neutral
    strength: float  # 0-1
    confidence: float  # 0-1
    timestamp: int
    model_name: str
    stop_price: float = 0.0  # price at which the position is closed

class StatisticalArbitrageModel:
    """
    Pairs trading and statistical arbitrage
    """
    
    def __init__(self, lookback_days: int = 60):
        self.lookback_days = lookback_days
        self.cointegrated_pairs: List[Tuple[str, str]] = []
        self.spread_history: Dict[Tuple[str, str], List[float]] = {}
    
    def find_cointegrated_pairs(self, price_data: pd.DataFrame,
                                p_value_threshold: float = 0.05) -> List[Tuple[str, str]]:
        """Find cointegrated pairs with the Engle-Granger two-step test.

        Correlation alone does not imply cointegration: two series can be
        strongly correlated and still drift apart. Step 1 regresses s1 on s2
        and takes the residual; step 2 runs an Augmented Dickey-Fuller test on
        that residual and keeps the pair only when the residual is stationary
        at `p_value_threshold`.
        """
        try:
            from statsmodels.tsa.stattools import adfuller
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise RuntimeError(
                "no econometrics backend configured: install statsmodels for the "
                "Engle-Granger cointegration test"
            ) from exc

        symbols = price_data.columns.tolist()
        if len(symbols) < 2:
            raise ValueError("cointegration testing needs at least two series")

        pairs: List[Tuple[str, str]] = []
        for idx, s1 in enumerate(symbols):
            for s2 in symbols[idx + 1:]:
                series1 = price_data[s1].dropna()
                series2 = price_data[s2].dropna()
                joined = pd.concat([series1, series2], axis=1, join="inner").dropna()
                if len(joined) < 30:
                    continue

                y = joined.iloc[:, 0].to_numpy(dtype=float)
                x = joined.iloc[:, 1].to_numpy(dtype=float)
                if np.var(x) == 0 or np.var(y) == 0:
                    continue

                # Step 1: OLS hedge ratio, residual is the candidate spread.
                hedge_ratio = float(np.cov(y, x, ddof=1)[0, 1] / np.var(x, ddof=1))
                intercept = float(np.mean(y) - hedge_ratio * np.mean(x))
                residual = y - (intercept + hedge_ratio * x)

                # Step 2: ADF on the residual. Fail closed if the test errors.
                try:
                    adf = adfuller(residual, autolag="AIC")
                except Exception:
                    continue
                p_value = float(adf[1])
                if p_value <= p_value_threshold:
                    pairs.append((s1, s2))

        self.cointegrated_pairs = pairs
        return pairs
    
    def calculate_spread(self, s1_prices: pd.Series, s2_prices: pd.Series, 
                        hedge_ratio: float = 1.0) -> pd.Series:
        """Calculate spread between pairs"""
        return s1_prices - hedge_ratio * s2_prices
    
    def generate_signal(self, spread: pd.Series, current_spread: float) -> Optional[Signal]:
        """Generate trading signal from spread"""
        mean = spread.mean()
        std = spread.std()
        z_score = (current_spread - mean) / std
        
        if z_score > 2:  # Spread too wide, expect mean reversion down
            return Signal(
                symbol=f"{spread.name[0]}/{spread.name[1]}",
                direction=-1,
                strength=min(abs(z_score) / 3, 1.0),
                confidence=0.7,
                timestamp=int(time.time()),
                model_name="stat_arb"
            )
        elif z_score < -2:
            return Signal(
                symbol=f"{spread.name[0]}/{spread.name[1]}",
                direction=1,
                strength=min(abs(z_score) / 3, 1.0),
                confidence=0.7,
                timestamp=int(time.time()),
                model_name="stat_arb"
            )
        
        return None

class VolatilityModel:
    """
    GARCH-based volatility forecasting
    """
    
    def __init__(self, p: int = 1, q: int = 1):
        self.p = p
        self.q = q
        self.omega = 0.01
        self.alpha = [0.1] * p
        self.beta = [0.8] * q
    
    def fit(self, returns: np.ndarray) -> None:
        """Fit GARCH(1,1) by maximum likelihood.

        Estimates omega, alpha and beta under the stationarity constraint
        alpha + beta < 1. Refuses to fit on too few observations or on a
        series with no variance.
        """
        series = np.asarray(returns, dtype=float).ravel()
        if series.size < 30:
            raise ValueError("GARCH fit requires at least 30 observations")
        variance = float(np.var(series))
        if not np.isfinite(variance) or variance <= 0:
            raise ValueError("GARCH fit requires a series with positive variance")

        from scipy.optimize import minimize

        def neg_log_likelihood(params: np.ndarray) -> float:
            omega, alpha, beta = params
            if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 1:
                return 1e12
            sigma2 = np.empty(series.size)
            sigma2[0] = variance
            for t in range(1, series.size):
                sigma2[t] = omega + alpha * series[t - 1] ** 2 + beta * sigma2[t - 1]
            if np.any(sigma2 <= 0):
                return 1e12
            return float(0.5 * np.sum(np.log(sigma2) + series ** 2 / sigma2))

        initial = np.array([variance * 0.1, 0.1, 0.8])
        result = minimize(neg_log_likelihood, initial, method="Nelder-Mead",
                          options={"xatol": 1e-8, "fatol": 1e-10, "maxiter": 2000})
        if not result.success:
            raise RuntimeError(f"GARCH fit did not converge: {result.message}")

        omega, alpha, beta = result.x
        self.omega = float(omega)
        self.alpha = [float(alpha)] * self.p
        self.beta = [float(beta)] * self.q
        self._fitted = True

    def forecast(self, returns: np.ndarray) -> float:
        """Forecast next-period volatility from the fitted parameters."""
        if not getattr(self, "_fitted", False):
            raise RuntimeError("VolatilityModel.forecast called before fit")

        series = np.asarray(returns, dtype=float).ravel()
        if series.size == 0:
            raise ValueError("cannot forecast volatility from an empty series")

        sigma2 = self.omega
        for r in series[-self.p:]:
            sigma2 += self.alpha[0] * r ** 2
        for v in series[-self.q:]:
            sigma2 += self.beta[0] * v

        return float(np.sqrt(sigma2))
    
    def calculate_var(self, returns: np.ndarray, confidence: float = 0.95) -> float:
        """Calculate Value at Risk"""
        volatility = self.forecast(returns)
        z = 1.96 if confidence == 0.95 else 2.58
        return volatility * z

# ========================================================================
# AI TRADING MODELS
# ========================================================================

class MLTradingModel:
    """
    Machine learning for price prediction
    """
    
    def __init__(self, model_type: str = "gradient_boosting"):
        self.model_type = model_type
        self.model = None
        self.feature_names: List[str] = []
    
    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create features for ML model"""
        features = pd.DataFrame()
        
        # Price returns
        features['returns_1d'] = df['close'].pct_change(1)
        features['returns_5d'] = df['close'].pct_change(5)
        features['returns_20d'] = df['close'].pct_change(20)
        
        # Moving averages
        features['sma_20'] = df['close'].rolling(20).mean()
        features['sma_50'] = df['close'].rolling(50).mean()
        features['ema_12'] = df['close'].ewm(span=12).mean()
        
        # Volatility
        features['volatility_20d'] = df['close'].pct_change().rolling(20).std()
        features['volatility_60d'] = df['close'].pct_change().rolling(60).std()
        
        # Momentum
        features['rsi'] = self._calculate_rsi(df['close'], 14)
        features['macd'] = self._calculate_macd(df['close'])
        
        # Volume features
        features['volume_ma_20'] = df['volume'].rolling(20).mean()
        features['volume_ratio'] = df['volume'] / df['volume'].rolling(20).mean()
        
        # Bollinger Bands
        bb = self._calculate_bollinger(df['close'], 20)
        features['bb_upper'] = bb['upper']
        features['bb_lower'] = bb['lower']
        features['bb_position'] = (df['close'] - bb['lower']) / (bb['upper'] - bb['lower'])
        
        self.feature_names = features.columns.tolist()
        return features.fillna(0)
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def _calculate_macd(self, prices: pd.Series, fast: int = 12, slow: int = 26) -> pd.Series:
        ema_fast = prices.ewm(span=fast).mean()
        ema_slow = prices.ewm(span=slow).mean()
        return ema_fast - ema_slow
    
    def _calculate_bollinger(self, prices: pd.Series, period: int = 20) -> Dict:
        sma = prices.rolling(period).mean()
        std = prices.rolling(period).std()
        return {
            'upper': sma + 2 * std,
            'middle': sma,
            'lower': sma - 2 * std
        }
    
    def train(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Fit the model on labelled feature rows.

        Fails closed when no estimator backend is installed, rather than
        reporting a trained model that would only emit noise.
        """
        if len(X) != len(y):
            raise ValueError("feature matrix and labels must have equal length")
        if len(X) == 0:
            raise ValueError("cannot train on an empty feature matrix")

        try:
            from sklearn.ensemble import GradientBoostingRegressor
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise RuntimeError(
                "no ML backend configured: install scikit-learn to train MLTradingModel"
            ) from exc

        values = np.nan_to_num(np.asarray(X, dtype=float))
        self.model = GradientBoostingRegressor(random_state=0)
        self.model.fit(values, np.asarray(y, dtype=float))
        self._feature_width = values.shape[1]

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Predict with the fitted model. Refuses to predict before training."""
        if self.model is None:
            raise RuntimeError("MLTradingModel.predict called before train")

        values = np.nan_to_num(np.asarray(X, dtype=float))
        if values.ndim == 1:
            values = values.reshape(1, -1)
        if values.shape[1] != self._feature_width:
            raise ValueError(
                f"feature width {values.shape[1]} does not match training width {self._feature_width}"
            )
        return np.asarray(self.model.predict(values), dtype=float)

class LLMInfrastructure:
    """
    Large Language Model infrastructure for:
    - Customer support automation
    - Market analysis
    - Report generation
    - RAG (Retrieval-Augmented Generation)
    """
    
    def __init__(self, embedder=None, completion_fn=None):
        """
        @param embedder: callable(List[str]) -> np.ndarray of shape (n, dim).
        @param completion_fn: callable(prompt: str) -> str.
        Both are required for the corresponding operation. There is no built-in
        fallback: a random vector or a canned sentence is not a real embedding
        or model answer.
        """
        self._embedder = embedder
        self._completion_fn = completion_fn
        self.vector_store: Dict[str, np.ndarray] = {}

    def create_embeddings(self, texts: List[str]) -> np.ndarray:
        """Embed texts through the configured provider."""
        if self._embedder is None:
            raise RuntimeError(
                "no embedding provider configured; refusing to return synthetic vectors"
            )
        vectors = np.asarray(self._embedder(texts), dtype=float)
        if vectors.shape[0] != len(texts):
            raise ValueError("embedding provider returned the wrong number of vectors")
        return vectors
    
    def semantic_search(self, query: str, top_k: int = 5) -> List[Dict]:
        """Semantic search over documents"""
        query_embedding = self.create_embeddings([query])[0]
        
        results = []
        for doc_id, doc_embedding in self.vector_store.items():
            similarity = np.dot(query_embedding, doc_embedding)
            results.append({
                'doc_id': doc_id,
                'score': float(similarity)
            })
        
        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:top_k]
    
    def rag_query(self, query: str, context_docs: List[str]) -> str:
        """Answer a query using retrieved context via the configured model."""
        if self._completion_fn is None:
            raise RuntimeError(
                "no LLM provider configured; refusing to return a canned answer"
            )
        context = "\n\n".join(context_docs)
        prompt = f"Context:\n{context}\n\nQuestion: {query}\nAnswer:"
        return self._completion_fn(prompt)
    
    def generate_market_report(self, market_data: Dict) -> str:
        """Generate a market report from real market data via the configured model."""
        if self._completion_fn is None:
            raise RuntimeError(
                "no LLM provider configured; refusing to emit a templated market report"
            )
        missing = [k for k in ("btc_price", "eth_price") if market_data.get(k) is None]
        if missing:
            raise ValueError(f"market_data is missing required fields: {missing}")

        prompt = (
            "Write a market analysis report from this data. "
            f"BTC: {market_data['btc_price']}, ETH: {market_data['eth_price']}, "
            f"summary: {market_data.get('summary', 'n/a')}, "
            f"sentiment: {market_data.get('sentiment', 'n/a')}"
        )
        return self._completion_fn(prompt)


# ========================================================================
# BACKTESTING ENGINE
# ========================================================================

class BacktestEngine:
    """
    Strategy backtesting with realistic simulation
    """
    
    def __init__(self, initial_capital: float = 100000):
        self.initial_capital = initial_capital
        self.equity_curve = [initial_capital]
        self.trades: List[Dict] = []
    
    def run(
        self,
        data: pd.DataFrame,
        signals: List[Signal],
        commission: float = 0.001,
        slippage: float = 0.0005
    ) -> Dict:
        """Run backtest"""
        capital = self.initial_capital
        position = 0
        entry_price = 0
        
        for i, row in data.iterrows():
            # Check for signals
            signal = self._get_signal_at_time(signals, row.name)
            
            if signal and position == 0 and signal.direction != 0:
                # Enter position
                entry_price = row['close'] * (1 + slippage if signal.direction == 1 else 1 - slippage)
                position_size = (capital * 0.1) / entry_price  # 10% risk
                position = position_size * signal.direction
            
            elif position != 0:
                # Check exit conditions
                pnl = (row['close'] - entry_price) * position
                exit_signal = self._should_exit(signal, row)
                
                if exit_signal:
                    exit_price = row['close'] * (1 - slippage if position > 0 else 1 + slippage)
                    pnl = (exit_price - entry_price) * position
                    pnl -= abs(position) * entry_price * commission  # Commission
                    
                    capital += pnl
                    self.trades.append({
                        'entry': entry_price,
                        'exit': exit_price,
                        'pnl': pnl,
                        'size': abs(position)
                    })
                    
                    position = 0
                    entry_price = 0
            
            self.equity_curve.append(capital)
        
        return self._calculate_metrics()
    
    def _get_signal_at_time(self, signals: List[Signal], timestamp) -> Optional[Signal]:
        for s in signals:
            if s.timestamp == timestamp:
                return s
        return None
    
    def _should_exit(self, entry_signal: Signal, row) -> bool:
        """Exit when the entry signal's stop level is breached.

        The stop travels with the signal, so a backtest closes a position on a
        real price condition instead of on every bar.
        """
        if entry_signal is None or entry_signal.stop_price <= 0:
            return False
        if entry_signal.direction > 0 and row['close'] <= entry_signal.stop_price:
            return True
        if entry_signal.direction < 0 and row['close'] >= entry_signal.stop_price:
            return True
        return False
    
    def _calculate_metrics(self) -> Dict:
        equity = np.array(self.equity_curve)
        returns = np.diff(equity) / equity[:-1]
        
        return {
            'total_return': (equity[-1] - self.initial_capital) / self.initial_capital,
            'sharpe_ratio': np.mean(returns) / np.std(returns) * np.sqrt(252) if np.std(returns) > 0 else 0,
            'max_drawdown': self._max_drawdown(equity),
            'win_rate': len([t for t in self.trades if t['pnl'] > 0]) / len(self.trades) if self.trades else 0,
            'total_trades': len(self.trades),
            'avg_trade': np.mean([t['pnl'] for t in self.trades]) if self.trades else 0
        }
    
    def _max_drawdown(self, equity: np.ndarray) -> float:
        peak = np.maximum.accumulate(equity)
        drawdown = (equity - peak) / peak
        return abs(np.min(drawdown))

# ========================================================================
# FEATURE STORE
# ========================================================================

class FeatureStore:
    """
    Feature store for ML training and inference
    """
    
    def __init__(self):
        self.features: Dict[str, pd.DataFrame] = {}
        self.metadata: Dict[str, Dict] = {}
    
    def register_feature(self, name: str, features: pd.DataFrame, 
                        owner: str, description: str) -> None:
        """Register a feature set"""
        self.features[name] = features
        self.metadata[name] = {
            'owner': owner,
            'description': description,
            'created_at': time.time(),
            'rows': len(features),
            'columns': len(features.columns)
        }
    
    def get_feature(self, name: str, as_of: Optional[int] = None) -> pd.DataFrame:
        """Get feature values at point in time"""
        if name not in self.features:
            raise KeyError(f"Feature {name} not found")
        
        df = self.features[name]
        if as_of:
            return df[df.index <= as_of]
        return df
    
    def get_online_features(self, keys: List[str], feature_names: List[str]) -> Dict:
        """Get features for online inference"""
        result = {}
        for key in keys:
            result[key] = {}
            for fname in feature_names:
                if fname in self.features:
                    result[key][fname] = self.features[fname].loc[key].to_dict()
        return result

# ========================================================================
# FRAUD DETECTION MODELS
# ========================================================================

class FraudDetectionModel:
    """
    Real-time fraud detection using ensemble methods
    """
    
    def __init__(self):
        self.rules_engine = RuleEngine()
        self.ml_model = None
        self.baselines: Dict[str, Dict] = {}
    
    def analyze_transaction(self, tx: Dict) -> FraudResult:
        """Analyze transaction for fraud indicators"""
        triggers = []
        risk_score = 0.0
        
        # Rule-based checks
        rule_result = self.rules_engine.check(tx)
        triggers.extend(rule_result['triggered'])
        risk_score += rule_result['score']
        
# ML model check. With no trained model attached the contribution is
        # omitted rather than replaced by a fixed constant.
        if self.ml_model is not None:
            risk_score += self._ml_predict(tx)

        risk_score += self._check_behavioral(tx)

        return FraudResult(
            risk_score=min(risk_score, 1.0),
            triggers=triggers,
            action="BLOCK" if risk_score > 0.8 else "ALLOW"
        )

    def _ml_predict(self, tx: Dict) -> float:
        """Score with the attached estimator. Requires a fitted model."""
        if self.ml_model is None:
            raise RuntimeError("FraudDetectionModel._ml_predict called with no model attached")
        features = np.array([[
            float(tx.get('amount', 0.0)),
            float(tx.get('tx_count_1min', 0)),
            float(tx.get('account_age_days', 0)),
            float(tx.get('geo_velocity_kmh', 0.0)),
        ]])
        prediction = float(np.asarray(self.ml_model.predict(features)).ravel()[0])
        return max(0.0, min(prediction, 1.0))

    def _check_behavioral(self, tx: Dict) -> float:
        """Score deviation from the account's recorded baselines.

        Without a baseline for the account there is nothing to compare against,
        so the contribution is zero rather than a fixed placeholder.
        """
        account = tx.get('account_id')
        baseline = self.baselines.get(account) if account else None
        if not baseline:
            return 0.0

        score = 0.0
        mean_amount = baseline.get('mean_amount')
        std_amount = baseline.get('std_amount')
        if mean_amount and std_amount:
            z = abs(float(tx.get('amount', 0.0)) - mean_amount) / std_amount
            score += min(z / 10.0, 0.3)

        mean_velocity = baseline.get('mean_velocity')
        if mean_velocity and float(tx.get('geo_velocity_kmh', 0.0)) > mean_velocity * 3:
            score += 0.2
        return min(score, 0.5)

@dataclass
class FraudResult:
    risk_score: float
    triggers: List[str]
    action: str

class RuleEngine:
    """Rule-based fraud detection"""
    
    def __init__(self):
        self.rules = [
            Rule("velocity_1min", self._check_velocity_1min, 0.3),
            Rule("large_amount", self._check_large_amount, 0.4),
            Rule("new_account", self._check_new_account, 0.2),
            Rule("geo_mismatch", self._check_geo_mismatch, 0.3),
        ]
    
    def check(self, tx: Dict) -> Dict:
        triggered = []
        score = 0.0
        
        for rule in self.rules:
            if rule.check(tx):
                triggered.append(rule.name)
                score += rule.weight
        
        return {'triggered': triggered, 'score': score}
    
    def _check_velocity_1min(self, tx: Dict) -> bool:
        return tx.get('tx_count_1min', 0) > 10
    
    def _check_large_amount(self, tx: Dict) -> bool:
        return tx.get('amount', 0) > 10000
    
    def _check_new_account(self, tx: Dict) -> bool:
        return tx.get('account_age_days', 999) < 7
    
    def _check_geo_mismatch(self, tx: Dict) -> bool:
        return tx.get('geo_velocity_kmh', 0) > 500

@dataclass
class Rule:
    name: str
    check: callable
    weight: float

# ========================================================================
# COMMAND LINE ENTRY POINT
# ========================================================================

def main(argv: Optional[List[str]] = None) -> int:
    """Run a backtest on real candles and report the metrics.

    usage: quant_research.py <candles.csv> <SYMBOL> [initial_capital]
    """
    import csv
    import sys

    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) < 2:
        print("usage: quant_research.py <candles.csv> <SYMBOL> [initial_capital]",
              file=sys.stderr)
        return 1

    csv_path, symbol = argv[0], argv[1]
    try:
        initial_capital = float(argv[2]) if len(argv) > 2 else 100000.0
    except ValueError:
        print(f"invalid initial capital: {argv[2]}", file=sys.stderr)
        return 1

    rows = []
    try:
        with open(csv_path, newline="") as handle:
            reader = csv.DictReader(handle)
            required = {"timestamp", "open", "high", "low", "close", "volume"}
            if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
                raise ValueError(f"candle file must contain columns {sorted(required)}")
            for row in reader:
                rows.append(row)
    except (OSError, ValueError) as exc:
        print(f"cannot load candles: {exc}", file=sys.stderr)
        return 1

    if not rows:
        print(f"candle file {csv_path} contained no rows", file=sys.stderr)
        return 1

    data = pd.DataFrame(
        {
            "timestamp": [int(r["timestamp"]) for r in rows],
            "open": [float(r["open"]) for r in rows],
            "high": [float(r["high"]) for r in rows],
            "low": [float(r["low"]) for r in rows],
            "close": [float(r["close"]) for r in rows],
            "volume": [float(r["volume"]) for r in rows],
        }
    ).set_index("timestamp")

    model = MLTradingModel()
    feature_frame = model.create_features(data)

    # Signals come from the features, not from invented values: a long when the
    # 20-period trend is up and RSI is not overbought, a short in the mirror.
    signals: List[Signal] = []
    for ts, feature in feature_frame.iterrows():
        if not np.isfinite(feature["sma_20"]) or not np.isfinite(feature["rsi"]):
            continue
        close = float(data.loc[ts, "close"])
        if close > feature["sma_20"] and feature["rsi"] < 70:
            signals.append(Signal(symbol, 1, 1.0, 0.6, int(ts), "trend", stop_price=close * 0.98))
        elif close < feature["sma_20"] and feature["rsi"] > 30:
            signals.append(Signal(symbol, -1, 1.0, 0.6, int(ts), "trend", stop_price=close * 1.02))

    engine = BacktestEngine(initial_capital=initial_capital)
    metrics = engine.run(data, signals)

    print(f"{symbol} backtest over {len(data)} bars ({len(signals)} signals)")
    for key in sorted(metrics):
        value = metrics[key]
        print(f"  {key}: {value:.6f}" if isinstance(value, float) else f"  {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
