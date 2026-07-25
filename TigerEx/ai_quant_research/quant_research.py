#!/usr/bin/env python3
"""
TigerEx AI Quant Research Platform
================================

Production-grade quantitative research and machine learning platform
for cryptocurrency trading.

Features:
- Data collection and preprocessing
- Feature engineering
- Technical indicators
- Machine learning models
- Backtesting framework
- Portfolio optimization
- Risk management

Author: TigerEx Research Team
"""

import json
import logging
import math
import pickle
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

# ============================================================================
# CONFIGURATION
# ============================================================================

logger = logging.getLogger(__name__)


class DataSource(Enum):
    """Data source types"""
    BINANCE = "binance"
    COINBASE = "coinbase"
    KRAKEN = "kraken"
    FTX = "ftx"
    INTERNAL = "internal"


class ModelType(Enum):
    """Machine learning model types"""
    LINEAR_REGRESSION = "linear_regression"
    LOGISTIC_REGRESSION = "logistic_regression"
    RANDOM_FOREST = "random_forest"
    GRADIENT_BOOSTING = "gradient_boosting"
    LSTM = "lstm"
    TRANSFORMER = "transformer"
    PROPHET = "prophet"
    ARIMA = "arima"


class BacktestMode(Enum):
    """Backtest execution modes"""
    WALK_FORWARD = "walk_forward"
    CROSS_VALIDATION = "cross_validation"
    MONTE_CARLO = "monte_carlo"


@dataclass
class TradingConfig:
    """Trading configuration"""
    initial_capital: float = 100000.0
    commission: float = 0.001  # 0.1%
    slippage: float = 0.0005  # 0.05%
    leverage: float = 1.0
    max_position_size: float = 0.1  # 10% of capital
    risk_per_trade: float = 0.02  # 2% risk per trade


@dataclass
class MarketData:
    """Market data container"""
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    quote_volume: Optional[float] = None
    trades: Optional[int] = None
    
    @property
    def typical_price(self) -> float:
        """Typical price = (High + Low + Close) / 3"""
        return (self.high + self.low + self.close) / 3
    
    @property
    def typical_volume(self) -> float:
        """Get typical volume"""
        return self.volume


# ============================================================================
# DATA COLLECTION
# ============================================================================

class DataCollector:
    """Collects and normalizes market data from multiple sources"""
    
    def __init__(self, source: DataSource = DataSource.BINANCE):
        self.source = source
        self.cache = {}
    
    def fetch_ohlcv(
        self,
        symbol: str,
        interval: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 1000
    ) -> pd.DataFrame:
        """
        Fetch OHLCV (Open, High, Low, Close, Volume) data
        
        Args:
            symbol: Trading pair (e.g., 'BTCUSDT')
            interval: Time interval (1m, 5m, 1h, 1d)
            start_time: Start timestamp in milliseconds
            end_time: End timestamp in milliseconds
            limit: Maximum number of records
            
        Returns:
            DataFrame with OHLCV data
        """
        # In production, would call actual exchange API
        # This is a placeholder that generates mock data
        
        intervals_ms = {
            '1m': 60000,
            '5m': 300000,
            '15m': 900000,
            '1h': 3600000,
            '4h': 14400000,
            '1d': 86400000
        }
        
        interval_ms = intervals_ms.get(interval, 60000)
        
        if end_time is None:
            end_time = int(time.time() * 1000)
        if start_time is None:
            start_time = end_time - (limit * interval_ms)
        
        # Generate synthetic data for demonstration
        n_points = min(limit, int((end_time - start_time) / interval_ms))
        
        timestamps = [start_time + i * interval_ms for i in range(n_points)]
        
        # Generate realistic price movement
        base_price = 50000.0  # Base BTC price
        prices = []
        current_price = base_price
        
        for _ in range(n_points):
            # Random walk with drift
            change = np.random.normal(0.0001, 0.02)
            current_price *= (1 + change)
            prices.append(current_price)
        
        data = []
        for i, ts in enumerate(timestamps):
            price = prices[i]
            volatility = 0.005
            
            data.append({
                'timestamp': ts,
                'open': price * (1 + np.random.uniform(-volatility, volatility)),
                'high': price * (1 + np.random.uniform(0, volatility * 2)),
                'low': price * (1 - np.random.uniform(0, volatility * 2)),
                'close': price,
                'volume': np.random.uniform(100, 1000),
                'quote_volume': price * np.random.uniform(100, 1000)
            })
        
        df = pd.DataFrame(data)
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        return df
    
    def fetch_order_book(
        self,
        symbol: str,
        depth: int = 20
    ) -> Dict:
        """Fetch order book data"""
        # Placeholder for order book data
        return {
            'bids': [(f"price_{i}", np.random.uniform(1000, 10000)) for i in range(depth)],
            'asks': [(f"price_{i}", np.random.uniform(1000, 10000)) for i in range(depth)],
            'timestamp': int(time.time() * 1000)
        }
    
    def fetch_funding_rate(self, symbol: str) -> float:
        """Fetch current funding rate"""
        # Placeholder
        return 0.0001
    
    def fetch_open_interest(self, symbol: str) -> float:
        """Fetch open interest"""
        # Placeholder
        return 1000000000.0


# ============================================================================
# FEATURE ENGINEERING
# ============================================================================

class FeatureEngine:
    """Feature engineering for time series data"""
    
    @staticmethod
    def add_returns(df: pd.DataFrame, periods: int = 1) -> pd.DataFrame:
        """Calculate returns"""
        df['returns'] = df['close'].pct_change(periods)
        df['log_returns'] = np.log(df['close'] / df['close'].shift(periods))
        return df
    
    @staticmethod
    def add_lag_features(df: pd.DataFrame, lags: List[int] = None) -> pd.DataFrame:
        """Add lagged features"""
        if lags is None:
            lags = [1, 2, 3, 5, 10, 20]
        
        for lag in lags:
            df[f'close_lag_{lag}'] = df['close'].shift(lag)
            df[f'returns_lag_{lag}'] = df['returns'].shift(lag)
        
        return df
    
    @staticmethod
    def add_rolling_features(
        df: pd.DataFrame,
        windows: List[int] = None
    ) -> pd.DataFrame:
        """Add rolling window features"""
        if windows is None:
            windows = [5, 10, 20, 50, 100, 200]
        
        for window in windows:
            # Moving averages
            df[f'sma_{window}'] = df['close'].rolling(window).mean()
            df[f'ema_{window}'] = df['close'].ewm(span=window).mean()
            
            # Volatility
            df[f'volatility_{window}'] = df['returns'].rolling(window).std()
            
            # Momentum
            df[f'momentum_{window}'] = df['close'].pct_change(window)
            
            # High/Low range
            df[f'high_range_{window}'] = df['high'].rolling(window).max() - df['low'].rolling(window).min()
        
        return df
    
    @staticmethod
    def add_bollinger_bands(
        df: pd.DataFrame,
        window: int = 20,
        num_std: float = 2.0
    ) -> pd.DataFrame:
        """Add Bollinger Bands"""
        df[f'bb_middle_{window}'] = df['close'].rolling(window).mean()
        rolling_std = df['close'].rolling(window).std()
        
        df[f'bb_upper_{window}'] = df[f'bb_middle_{window}'] + (rolling_std * num_std)
        df[f'bb_lower_{window}'] = df[f'bb_middle_{window}'] - (rolling_std * num_std)
        
        # Position in bands
        df[f'bb_position_{window}'] = (df['close'] - df[f'bb_lower_{window}']) / (
            df[f'bb_upper_{window}'] - df[f'bb_lower_{window}']
        )
        
        return df
    
    @staticmethod
    def add_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
        """Add Relative Strength Index"""
        delta = df['close'].diff()
        
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        
        avg_gain = gain.rolling(period).mean()
        avg_loss = loss.rolling(period).mean()
        
        rs = avg_gain / avg_loss
        df[f'rsi_{period}'] = 100 - (100 / (1 + rs))
        
        return df
    
    @staticmethod
    def add_macd(
        df: pd.DataFrame,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9
    ) -> pd.DataFrame:
        """Add MACD (Moving Average Convergence Divergence)"""
        ema_fast = df['close'].ewm(span=fast).mean()
        ema_slow = df['close'].ewm(span=slow).mean()
        
        df['macd'] = ema_fast - ema_slow
        df['macd_signal'] = df['macd'].ewm(span=signal).mean()
        df['macd_histogram'] = df['macd'] - df['macd_signal']
        
        return df
    
    @staticmethod
    def add_atr(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
        """Add Average True Range"""
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        
        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        df[f'atr_{period}'] = true_range.rolling(period).mean()
        
        # ATR as percentage of close
        df[f'atr_percent_{period}'] = df[f'atr_{period}'] / df['close'] * 100
        
        return df
    
    @staticmethod
    def add_obv(df: pd.DataFrame) -> pd.DataFrame:
        """Add On-Balance Volume"""
        df['obv'] = (np.sign(df['close'].diff()) * df['volume']).fillna(0).cumsum()
        df['obv_ma'] = df['obv'].rolling(20).mean()
        
        return df
    
    @staticmethod
    def add_vwap(df: pd.DataFrame) -> pd.DataFrame:
        """Add Volume Weighted Average Price"""
        df['typical_price'] = (df['high'] + df['low'] + df['close']) / 3
        df['cumulative_tpv'] = (df['typical_price'] * df['volume']).cumsum()
        df['cumulative_volume'] = df['volume'].cumsum()
        df['vwap'] = df['cumulative_tpv'] / df['cumulative_volume']
        
        return df


# ============================================================================
# MACHINE LEARNING MODELS
# ============================================================================

class BaseModel(ABC):
    """Abstract base class for ML models"""
    
    def __init__(self, config: Dict = None):
        self.config = config or {}
        self.model = None
        self.is_trained = False
    
    @abstractmethod
    def train(self, X: np.ndarray, y: np.ndarray) -> 'BaseModel':
        """Train the model"""
        pass
    
    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Make predictions"""
        pass
    
    def save(self, path: str) -> None:
        """Save model to disk"""
        with open(path, 'wb') as f:
            pickle.dump(self.model, f)
    
    def load(self, path: str) -> None:
        """Load model from disk"""
        with open(path, 'rb') as f:
            self.model = pickle.load(f)


class PricePredictionModel(BaseModel):
    """Price prediction model wrapper"""
    
    def __init__(self, model_type: ModelType = ModelType.RANDOM_FOREST, config: Dict = None):
        super().__init__(config)
        self.model_type = model_type
    
    def train(self, X: np.ndarray, y: np.ndarray) -> 'PricePredictionModel':
        """Train the model"""
        
        if self.model_type == ModelType.LINEAR_REGRESSION:
            from sklearn.linear_model import LinearRegression
            self.model = LinearRegression(**self.config)
        
        elif self.model_type == ModelType.RANDOM_FOREST:
            from sklearn.ensemble import RandomForestRegressor
            self.config.setdefault('n_estimators', 100)
            self.config.setdefault('max_depth', 10)
            self.config.setdefault('random_state', 42)
            self.model = RandomForestRegressor(**self.config)
        
        elif self.model_type == ModelType.GRADIENT_BOOSTING:
            from sklearn.ensemble import GradientBoostingRegressor
            self.config.setdefault('n_estimators', 100)
            self.config.setdefault('learning_rate', 0.1)
            self.model = GradientBoostingRegressor(**self.config)
        
        else:
            raise ValueError(f"Unsupported model type: {self.model_type}")
        
        self.model.fit(X, y)
        self.is_trained = True
        return self
    
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Make predictions"""
        if not self.is_trained:
            raise RuntimeError("Model not trained")
        return self.model.predict(X)
    
    def feature_importance(self) -> Optional[np.ndarray]:
        """Get feature importance scores"""
        if hasattr(self.model, 'feature_importances_'):
            return self.model.feature_importances_
        return None


class SignalGenerator:
    """Generates trading signals from model predictions"""
    
    def __init__(self, threshold: float = 0.5):
        self.threshold = threshold
    
    def generate_signals(
        self,
        predictions: np.ndarray,
        method: str = 'binary'
    ) -> np.ndarray:
        """Generate trading signals from predictions"""
        
        if method == 'binary':
            # Binary: 1 = buy, 0 = sell/hold
            return (predictions > self.threshold).astype(int)
        
        elif method == 'ternary':
            # Ternary: 1 = buy, 0 = hold, -1 = sell
            signals = np.zeros_like(predictions)
            signals[predictions > self.threshold] = 1
            signals[predictions < -self.threshold] = -1
            return signals
        
        elif method == 'continuous':
            # Continuous: raw prediction values
            return predictions
        
        else:
            raise ValueError(f"Unknown signal method: {method}")


# ============================================================================
# BACKTESTING FRAMEWORK
# ============================================================================

@dataclass
class Trade:
    """Trade record"""
    entry_time: int
    entry_price: float
    position_size: float
    side: str  # 'long' or 'short'
    exit_time: Optional[int] = None
    exit_price: Optional[float] = None
    pnl: Optional[float] = None
    pnl_percent: Optional[float] = None
    
    def close(self, exit_time: int, exit_price: float):
        """Close the trade"""
        self.exit_time = exit_time
        self.exit_price = exit_price
        
        if self.side == 'long':
            self.pnl = (exit_price - self.entry_price) * self.position_size
        else:
            self.pnl = (self.entry_price - exit_price) * self.position_size
        
        self.pnl_percent = (self.pnl / (self.entry_price * self.position_size)) * 100


@dataclass
class BacktestResult:
    """Backtest results"""
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    total_pnl: float
    total_pnl_percent: float
    max_drawdown: float
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float
    average_trade_duration: float
    trades: List[Trade]
    
    def to_dict(self) -> Dict:
        """Convert to dictionary"""
        return {
            'total_trades': self.total_trades,
            'winning_trades': self.winning_trades,
            'losing_trades': self.losing_trades,
            'win_rate': self.win_rate,
            'total_pnl': self.total_pnl,
            'total_pnl_percent': self.total_pnl_percent,
            'max_drawdown': self.max_drawdown,
            'sharpe_ratio': self.sharpe_ratio,
            'sortino_ratio': self.sortino_ratio,
            'calmar_ratio': self.calmar_ratio,
            'average_trade_duration': self.average_trade_duration,
        }


class Backtester:
    """Backtesting framework for trading strategies"""
    
    def __init__(self, config: TradingConfig):
        self.config = config
        self.trades: List[Trade] = []
        self.equity_curve: List[float] = [config.initial_capital]
        self.current_position: Optional[Trade] = None
    
    def run(
        self,
        data: pd.DataFrame,
        signals: np.ndarray,
        verbose: bool = True
    ) -> BacktestResult:
        """Run backtest on historical data"""
        
        self.trades = []
        self.equity_curve = [self.config.initial_capital]
        self.current_position = None
        
        for i in range(len(data)):
            signal = signals[i]
            price = data.iloc[i]['close']
            timestamp = data.iloc[i]['timestamp']
            
            # Entry signals
            if signal == 1 and self.current_position is None:
                position_size = (
                    self.config.initial_capital * self.config.max_position_size
                ) / price
                
                self.current_position = Trade(
                    entry_time=timestamp,
                    entry_price=price,
                    position_size=position_size,
                    side='long'
                )
            
            # Exit signals
            elif signal == -1 and self.current_position is not None:
                self.current_position.close(timestamp, price)
                self.trades.append(self.current_position)
                
                # Apply slippage and commission
                entry_cost = (
                    self.current_position.entry_price * 
                    self.current_position.position_size * 
                    self.config.commission
                )
                exit_cost = (
                    price * 
                    self.current_position.position_size * 
                    self.config.commission
                )
                slippage_cost = (
                    price * 
                    self.current_position.position_size * 
                    self.config.slippage
                )
                
                self.current_position.pnl -= (entry_cost + exit_cost + slippage_cost)
                self.current_position = None
            
            # Update equity
            if self.current_position is not None:
                unrealized_pnl = (
                    (price - self.current_position.entry_price) * 
                    self.current_position.position_size
                )
                if self.current_position.side == 'short':
                    unrealized_pnl = -unrealized_pnl
            else:
                unrealized_pnl = 0
            
            equity = self.equity_curve[-1] + unrealized_pnl
            self.equity_curve.append(equity)
        
        # Close any open position at the end
        if self.current_position is not None:
            final_price = data.iloc[-1]['close']
            final_timestamp = data.iloc[-1]['timestamp']
            self.current_position.close(final_timestamp, final_price)
            self.trades.append(self.current_position)
        
        return self._calculate_metrics()
    
    def _calculate_metrics(self) -> BacktestResult:
        """Calculate performance metrics"""
        
        if not self.trades:
            return BacktestResult(
                total_trades=0,
                winning_trades=0,
                losing_trades=0,
                win_rate=0,
                total_pnl=0,
                total_pnl_percent=0,
                max_drawdown=0,
                sharpe_ratio=0,
                sortino_ratio=0,
                calmar_ratio=0,
                average_trade_duration=0,
                trades=[]
            )
        
        # Basic metrics
        total_trades = len(self.trades)
        winning_trades = sum(1 for t in self.trades if t.pnl and t.pnl > 0)
        losing_trades = total_trades - winning_trades
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        total_pnl = sum(t.pnl for t in self.trades if t.pnl)
        total_pnl_percent = (
            total_pnl / self.config.initial_capital * 100
        )
        
        # Drawdown
        equity = np.array(self.equity_curve)
        running_max = np.maximum.accumulate(equity)
        drawdowns = (equity - running_max) / running_max
        max_drawdown = abs(np.min(drawdowns)) * 100
        
        # Sharpe Ratio (annualized)
        returns = np.diff(equity) / equity[:-1]
        if len(returns) > 0 and np.std(returns) > 0:
            sharpe_ratio = np.mean(returns) / np.std(returns) * np.sqrt(252 * 24 * 60)
        else:
            sharpe_ratio = 0
        
        # Sortino Ratio
        negative_returns = returns[returns < 0]
        if len(negative_returns) > 0 and np.std(negative_returns) > 0:
            sortino_ratio = np.mean(returns) / np.std(negative_returns) * np.sqrt(252 * 24 * 60)
        else:
            sortino_ratio = 0
        
        # Calmar Ratio (annual return / max drawdown)
        annual_return = total_pnl_percent * (365 / len(self.equity_curve))
        calmar_ratio = annual_return / max_drawdown if max_drawdown > 0 else 0
        
        # Average trade duration
        durations = []
        for trade in self.trades:
            if trade.exit_time and trade.entry_time:
                durations.append(trade.exit_time - trade.entry_time)
        
        avg_duration = np.mean(durations) / (1000 * 60 * 60) if durations else 0  # in hours
        
        return BacktestResult(
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=win_rate * 100,
            total_pnl=total_pnl,
            total_pnl_percent=total_pnl_percent,
            max_drawdown=max_drawdown,
            sharpe_ratio=sharpe_ratio,
            sortino_ratio=sortino_ratio,
            calmar_ratio=calmar_ratio,
            average_trade_duration=avg_duration,
            trades=self.trades
        )


# ============================================================================
# PORTFOLIO OPTIMIZATION
# ============================================================================

class PortfolioOptimizer:
    """Portfolio optimization using Modern Portfolio Theory"""
    
    @staticmethod
    def calculate_returns(prices: pd.DataFrame) -> pd.DataFrame:
        """Calculate returns from prices"""
        return prices.pct_change().dropna()
    
    @staticmethod
    def calculate_covariance(returns: pd.DataFrame) -> pd.DataFrame:
        """Calculate covariance matrix"""
        return returns.cov()
    
    @staticmethod
    def calculate_correlation(returns: pd.DataFrame) -> pd.DataFrame:
        """Calculate correlation matrix"""
        return returns.corr()
    
    @staticmethod
    def efficient_frontier(
        returns: pd.DataFrame,
        n_portfolios: int = 100
    ) -> Tuple[List[float], List[float], List[np.ndarray]]:
        """
        Generate efficient frontier
        
        Returns:
            Tuple of (volatilities, returns, weights)
        """
        n_assets = len(returns.columns)
        mean_returns = returns.mean()
        cov_matrix = returns.cov()
        
        volatilities = []
        portfolio_returns = []
        weights_list = []
        
        for _ in range(n_portfolios):
            # Generate random weights
            weights = np.random.random(n_assets)
            weights /= np.sum(weights)
            
            # Portfolio return
            port_return = np.sum(weights * mean_returns) * 252
            
            # Portfolio volatility
            port_vol = np.sqrt(
                np.dot(weights.T, np.dot(cov_matrix * 252, weights))
            )
            
            volatilities.append(port_vol)
            portfolio_returns.append(port_return)
            weights_list.append(weights)
        
        return volatilities, portfolio_returns, weights_list
    
    @staticmethod
    def optimize_sharpe(
        returns: pd.DataFrame,
        risk_free_rate: float = 0.02
    ) -> np.ndarray:
        """Optimize for maximum Sharpe ratio"""
        from scipy.optimize import minimize
        
        n_assets = len(returns.columns)
        mean_returns = returns.mean() * 252
        cov_matrix = returns.cov() * 252
        
        def neg_sharpe(weights):
            port_return = np.sum(weights * mean_returns)
            port_vol = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
            return -(port_return - risk_free_rate) / port_vol
        
        constraints = ({'type': 'eq', 'fun': lambda x: np.sum(x) - 1})
        bounds = tuple((0, 1) for _ in range(n_assets))
        
        result = minimize(
            neg_sharpe,
            np.array([1.0 / n_assets] * n_assets),
            method='SLSQP',
            bounds=bounds,
            constraints=constraints
        )
        
        return result.x
    
    @staticmethod
    def optimize_minimum_variance(returns: pd.DataFrame) -> np.ndarray:
        """Optimize for minimum variance"""
        from scipy.optimize import minimize
        
        n_assets = len(returns.columns)
        cov_matrix = returns.cov() * 252
        
        def portfolio_variance(weights):
            return np.dot(weights.T, np.dot(cov_matrix, weights))
        
        constraints = ({'type': 'eq', 'fun': lambda x: np.sum(x) - 1})
        bounds = tuple((0, 1) for _ in range(n_assets))
        
        result = minimize(
            portfolio_variance,
            np.array([1.0 / n_assets] * n_assets),
            method='SLSQP',
            bounds=bounds,
            constraints=constraints
        )
        
        return result.x


# ============================================================================
# RISK MANAGEMENT
# ============================================================================

class RiskManager:
    """Risk management and position sizing"""
    
    def __init__(self, config: TradingConfig):
        self.config = config
    
    def calculate_position_size(
        self,
        entry_price: float,
        stop_loss: float,
        account_balance: float
    ) -> float:
        """
        Calculate position size based on risk management rules
        
        Args:
            entry_price: Entry price
            stop_loss: Stop loss price
            account_balance: Available capital
            
        Returns:
            Position size in base currency
        """
        # Risk amount
        risk_amount = account_balance * self.config.risk_per_trade
        
        # Price risk per unit
        price_risk = abs(entry_price - stop_loss)
        
        if price_risk == 0:
            return 0
        
        # Position size
        position_size = risk_amount / price_risk
        
        # Max position size check
        max_size = (account_balance * self.config.max_position_size) / entry_price
        position_size = min(position_size, max_size)
        
        return position_size
    
    def calculate_stop_loss(
        self,
        entry_price: float,
        side: str,
        atr: float,
        atr_multiplier: float = 2.0
    ) -> float:
        """Calculate stop loss based on ATR"""
        if side == 'long':
            return entry_price - (atr * atr_multiplier)
        else:
            return entry_price + (atr * atr_multiplier)
    
    def calculate_take_profit(
        self,
        entry_price: float,
        stop_loss: float,
        side: str,
        reward_risk_ratio: float = 2.0
    ) -> float:
        """Calculate take profit based on risk-reward ratio"""
        risk = abs(entry_price - stop_loss)
        reward = risk * reward_risk_ratio
        
        if side == 'long':
            return entry_price + reward
        else:
            return entry_price - reward
    
    def validate_trade(
        self,
        position_size: float,
        entry_price: float,
        stop_loss: float,
        account_balance: float
    ) -> Tuple[bool, str]:
        """Validate if trade meets risk criteria"""
        
        # Check position size
        max_size = (account_balance * self.config.max_position_size) / entry_price
        if position_size > max_size:
            return False, f"Position size exceeds maximum ({max_size})"
        
        # Check stop loss
        if stop_loss == 0:
            return False, "Invalid stop loss"
        
        # Check risk per trade
        risk = abs(entry_price - stop_loss) * position_size
        if risk > account_balance * self.config.risk_per_trade * 2:
            return False, "Risk exceeds maximum allowed"
        
        return True, "Trade validated"


# ============================================================================
# STRATEGY EXECUTION EXAMPLE
# ============================================================================

def example_strategy():
    """Example trading strategy using the framework"""
    
    # Configuration
    config = TradingConfig(
        initial_capital=100000.0,
        commission=0.001,
        slippage=0.0005,
        risk_per_trade=0.02
    )
    
    # Data collection
    collector = DataCollector(DataSource.BINANCE)
    data = collector.fetch_ohlcv('BTCUSDT', '1h', limit=1000)
    
    # Feature engineering
    engine = FeatureEngine()
    data = engine.add_returns(data)
    data = engine.add_lag_features(data)
    data = engine.add_rolling_features(data)
    data = engine.add_rsi(data)
    data = engine.add_macd(data)
    data = engine.add_bollinger_bands(data)
    
    # Prepare features
    feature_cols = [col for col in data.columns if col not in [
        'timestamp', 'datetime', 'open', 'high', 'low', 'close', 'volume'
    ]]
    X = data[feature_cols].fillna(0).values
    y = (data['close'].shift(-1) > data['close']).astype(int).values
    
    # Train model
    model = PricePredictionModel(ModelType.RANDOM_FOREST, {
        'n_estimators': 100,
        'max_depth': 10
    })
    model.train(X[:-1], y[:-1])
    
    # Generate signals
    predictions = model.predict(X[-100:])
    signal_gen = SignalGenerator(threshold=0.5)
    signals = signal_gen.generate_signals(predictions, method='ternary')
    
    # Pad signals to match data length
    full_signals = np.zeros(len(data))
    full_signals[-100:] = signals
    
    # Backtest
    backtester = Backtester(config)
    results = backtester.run(data, full_signals)
    
    # Print results
    print("=== Backtest Results ===")
    print(json.dumps(results.to_dict(), indent=2))
    
    return results


if __name__ == "__main__":
    example_strategy()
