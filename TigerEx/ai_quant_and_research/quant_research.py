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

class StatisticalArbitrageModel:
    """
    Pairs trading and statistical arbitrage
    """
    
    def __init__(self, lookback_days: int = 60):
        self.lookback_days = lookback_days
        self.cointegrated_pairs: List[Tuple[str, str]] = []
        self.spread_history: Dict[Tuple[str, str], List[float]] = {}
    
    def find_cointegrated_pairs(self, price_data: pd.DataFrame) -> List[Tuple[str, str]]:
        """Find cointegrated pairs using Engle-Granger test"""
        symbols = price_data.columns.tolist()
        pairs = []
        
        for i, s1 in enumerate(symbols):
            for s2 in symbols[i+1:]:
                # Simplified - would use proper statistical test
                correlation = price_data[s1].corr(price_data[s2])
                if abs(correlation) > 0.8:
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
        """Fit GARCH model to returns"""
        # Simplified - would use actual GARCH fitting
        self.omega = np.var(returns) * 0.1
    
    def forecast(self, returns: np.ndarray) -> float:
        """Forecast next-period volatility"""
        # GARCH(1,1) forecast
        sigma2 = self.omega
        for r in returns[-self.p:]:
            sigma2 += self.alpha[0] * r ** 2
        for v in returns[-self.q:]:
            sigma2 += self.beta[0] * v
        
        return np.sqrt(sigma2)
    
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
        """Train the model"""
        # Simplified - would use sklearn
        self.model = "trained_model"
    
    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """Generate predictions"""
        if self.model is None:
            return np.zeros(len(X))
        # Simplified prediction
        return np.random.randn(len(X)) * 0.5

class LLMInfrastructure:
    """
    Large Language Model infrastructure for:
    - Customer support automation
    - Market analysis
    - Report generation
    - RAG (Retrieval-Augmented Generation)
    """
    
    def __init__(self):
        self.embeddings_model = "text-embedding-3"
        self.llm_model = "gpt-4"
        self.vector_store = {}
    
    def create_embeddings(self, texts: List[str]) -> np.ndarray:
        """Create embeddings for texts"""
        # Would call embedding API
        # Return random embeddings for demo
        return np.random.randn(len(texts), 1536)
    
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
        """RAG query with context"""
        # Would use LLM with retrieved context
        return f"RAG response for: {query}"
    
    def generate_market_report(self, market_data: Dict) -> str:
        """Generate market analysis report"""
        return f"""
# Market Analysis Report

## Summary
{market_data.get('summary', 'N/A')}

## Key Metrics
- BTC Price: ${market_data.get('btc_price', 0):,.2f}
- ETH Price: ${market_data.get('eth_price', 0):,.2f}
- Market Sentiment: {market_data.get('sentiment', 'Neutral')}

## Recommendations
{self._generate_recommendations(market_data)}
        """
    
    def _generate_recommendations(self, data: Dict) -> str:
        return "- Consider diversification across sectors\n- Monitor key support levels\n- Stay informed on macro developments"

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
        return True  # Simplified
    
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
        
        # ML model check (would use actual model)
        ml_score = self._ml_predict(tx)
        risk_score += ml_score
        
        # Behavioral anomaly check
        anomaly_score = self._check_behavioral(tx)
        risk_score += anomaly_score
        
        return FraudResult(
            risk_score=min(risk_score, 1.0),
            triggers=triggers,
            action="BLOCK" if risk_score > 0.8 else "ALLOW"
        )
    
    def _ml_predict(self, tx: Dict) -> float:
        return 0.1  # Simplified
    
    def _check_behavioral(self, tx: Dict) -> float:
        return 0.05  # Simplified

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
# MAIN DEMO
# ========================================================================

def main():
    # Initialize systems
    stat_arb = StatisticalArbitrageModel()
    volatility = VolatilityModel()
    ml_model = MLTradingModel()
    llm = LLMInfrastructure()
    backtest = BacktestEngine()
    features = FeatureStore()
    fraud = FraudDetectionModel()
    
    # Example: Volatility forecast
    returns = np.random.randn(100) * 0.02
    volatility.fit(returns)
    vol_forecast = volatility.forecast(returns)
    var_95 = volatility.calculate_var(returns, 0.95)
    print(f"Volatility Forecast: {vol_forecast:.4f}")
    print(f"VaR (95%): ${var_95:.2f}")
    
    # Example: LLM market report
    report = llm.generate_market_report({
        'summary': 'Bullish momentum',
        'btc_price': 52000,
        'eth_price': 2800,
        'sentiment': 'Greed'
    })
    print(report)
    
    # Example: Fraud detection
    tx = {
        'amount': 50000,
        'tx_count_1min': 15,
        'account_age_days': 3,
        'geo_velocity_kmh': 800
    }
    result = fraud.analyze_transaction(tx)
    print(f"Fraud Risk: {result.risk_score:.2%}, Action: {result.action}")
    
    print("\nTigerEx AI/Quant Systems Ready")

if __name__ == "__main__":
    main()