#!/usr/bin/env python3
"""
TigerEx AI/ML Analytics Module
Fraud detection, price prediction, risk analytics, backtesting
"""

from __future__ import annotations

__version__ = "2.0.0"
__author__ = "TigerEx ML Team"

import numpy as np
import pandas as pd
from dataclasses import dataclass
from enum import Enum
from typing import Optional, List, Dict, Any

# ML Libraries
try:
    import sklearn
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
    from sklearn.preprocessing import StandardScaler, MinMaxScaler
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    
try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    import xgboost as xgb
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False


class ModelType(Enum):
    RANDandom_FOREST = "random_forest"
    GRADIENT_BOOSTING = "gradient_boosting"
    XGBOOST = "xgboost"
    LSTM = "lstm"


@dataclass
class TradingSignal:
    symbol: str
    action: str  # buy, sell, hold
    confidence: float
    predicted_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    timestamp: int = 0


@dataclass  
class FraudAlert:
    user_id: str
    alert_type: str
    severity: str  # low, medium, high, critical
    score: float
    description: str
    metadata: Dict[str, Any] = None


class FraudDetector:
    """Real-time fraud detection using ensemble of ML models"""
    
    def __init__(self):
        self.models = {}
        self.scaler = StandardScaler() if SKLEARN_AVAILABLE else None
        self.threshold = 0.85
        
    def add_model(self, name: str, model: Any) -> None:
        self.models[name] = model
        
    def predict(self, features: np.ndarray) -> FraudAlert:
        if not self.models or not SKLEARN_AVAILABLE:
            return FraudAlert(
                user_id="unknown",
                alert_type="unknown",
                severity="low",
                score=0.0,
                description="Model not initialized"
            )
        
        features_scaled = self.scaler.fit_transform(features.reshape(1, -1))
        
        scores = []
        for name, model in self.models.items():
            score = model.predict_proba(features_scaled)[0][1]
            scores.append(score)
        
        avg_score = np.mean(scores)
        
        if avg_score > 0.95:
            severity = "critical"
        elif avg_score > 0.85:
            severity = "high"
        elif avg_score > 0.70:
            severity = "medium"
        else:
            severity = "low"
            
        return FraudAlert(
            user_id="",
            alert_type="suspicious_activity",
            severity=severity,
            score=float(avg_score),
            description=f"Fraud probability: {avg_score:.2%}"
        )


class PricePredictor:
    """Price prediction using LSTM neural network"""
    
    def __init__(self, sequence_length: int = 60):
        self.sequence_length = sequence_length
        self.model = None
        self.scaler = MinMaxScaler()
        
    def build_model(self, input_dim: int) -> nn.Module:
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch not available")
            
        class PriceLSTM(nn.Module):
            def __init__(self, input_dim: int):
                super().__init__()
                self.lstm = nn.LSTM(input_dim, 128, batch_first=True)
                self.fc = nn.Sequential(
                    nn.Linear(128, 64),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(64, 1)
                )
                
            def forward(self, x):
                lstm_out, _ = self.lstm(x)
                return self.fc(lstm_out[:, -1, :])
                
        self.model = PriceLSTM(input_dim)
        return self.model
        
    def predict(self, sequence: np.ndarray) -> float:
        if not self.model:
            raise RuntimeError("Model not trained")
            
        self.model.eval()
        scaled = self.scaler.transform(sequence.reshape(1, -1))
        tensor = torch.FloatTensor(scaled)
        
        with torch.no_grad():
            pred = self.model(tensor).item()
            
        return pred


class RiskAnalyzer:
    """Portfolio risk analytics and VaR calculation"""
    
    def __init__(self, confidence_level: float = 0.95):
        self.confidence_level = confidence_level
        
    def calculate_var(self, returns: np.ndarray) -> float:
        return np.percentile(returns, (1 - self.confidence_level) * 100)
        
    def calculate_cvar(self, returns: np.ndarray) -> float:
        var = self.calculate_var(returns)
        return returns[returns <= var].mean()
        
    def calculate_sharpe_ratio(self, returns: np.ndarray, risk_free_rate: float = 0.02) -> float:
        excess_returns = returns - risk_free_rate / 252
        return excess_returns.mean() / excess_returns.std() * np.sqrt(252)
        
    def calculate_max_drawdown(self, equity_curve: np.ndarray) -> float:
        cummax = np.maximum.accumulate(equity_curve)
        drawdown = (equity_curve - cummax) / cummax
        return drawdown.min()


class Backtester:
    """Historical backtesting engine"""
    
    def __init__(self, initial_capital: float = 100000.0):
        self.initial_capital = initial_capital
        self.trades = []
        self.equity_curve = []
        
    def run(self, prices: pd.DataFrame, signals: List[TradingSignal], fees: float = 0.001) -> Dict[str, Any]:
        capital = self.initial_capital
        position = 0
        entry_price = 0
        
        for i, signal in enumerate(signals):
            if i >= len(prices):
                break
                
            current_price = prices.iloc[i]['close']
            
            if signal.action == "buy" and position == 0:
                position = capital / current_price * (1 - fees)
                entry_price = current_price
                capital = 0
                
            elif signal.action == "sell" and position > 0:
                capital = position * current_price * (1 - fees)
                pnl = (current_price - entry_price) * position
                self.trades.append({
                    'entry': entry_price,
                    'exit': current_price,
                    'pnl': pnl,
                    'return': pnl / (entry_price * position)
                })
                position = 0
                
            equity = capital + position * current_price
            self.equity_curve.append(equity)
            
        returns = np.diff(self.equity_curve) / self.equity_curve[:-1]
        risk = RiskAnalyzer()
        
        return {
            "total_return": (self.equity_curve[-1] - self.initial_capital) / self.initial_capital,
            "total_trades": len(self.trades),
            "win_rate": sum(1 for t in self.trades if t['pnl'] > 0) / max(len(self.trades), 1),
            "sharpe_ratio": risk.calculate_sharpe_ratio(returns),
            "max_drawdown": risk.calculate_max_drawdown(np.array(self.equity_curve)),
        }


def create_ml_pipeline(config: Dict[str, Any]) -> Any:
    pipeline_type = config.get("type", "fraud")
    
    if pipeline_type == "fraud":
        return FraudDetector()
    elif pipeline_type == "price":
        return PricePredictor(config.get("sequence_length", 60))
    elif pipeline_type == "risk":
        return RiskAnalyzer(config.get("confidence_level", 0.95))
    elif pipeline_type == "backtest":
        return Backtester(config.get("initial_capital", 100000))
    else:
        raise ValueError(f"Unknown pipeline type: {pipeline_type}")


if __name__ == "__main__":
    print("TigerEx ML Analytics v2.0.0")
    print(f"Sklearn: {'OK' if SKLEARN_AVAILABLE else 'NOT AVAILABLE'}")
    print(f"PyTorch: {'OK' if TORCH_AVAILABLE else 'NOT AVAILABLE'}")
    print(f"XGBoost: {'OK' if XGB_AVAILABLE else 'NOT AVAILABLE'}")