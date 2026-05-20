"""
TigerEx AI/ML Systems
- Fraud Detection Models
- Quant Research  
- Market Prediction
- Anomaly Detection
"""

# =============================================================================
# Fraud Detection - Requirements
# =============================================================================

pandas>=2.0.0
numpy>=1.24.0
scikit-learn>=1.3.0
xgboost>=1.7.0
lightgbm>=4.0.0
tensorflow>=2.14.0
torch>=2.1.0
psycopg2-binary>=2.9.9
redis>=5.0.0
joblib>=1.3.0
gradio>=3.40.0

# =============================================================================
# Fraud Detection Model
# =============================================================================

"""
Real-time fraud detection pipeline
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


class FraudDetector:
    """Multi-layer fraud detection system"""
    
    def __init__(self):
        self.rules_engine = RuleBasedDetector()
        self.ml_model = HybridDetector()
        self.behavior_model = BehaviorAnalyzer()
        self.network_analyzer = GraphAnalyzer()
        
        # Risk thresholds
        self.high_risk_threshold = 0.85
        self.medium_risk_threshold = 0.5
        
    def predict(self, event: Dict) -> FraudPrediction:
        """Run prediction across all layers"""
        
        # Layer 1: Rules (instant)
        rules_result = self.rules_engine.evaluate(event)
        if rules_result.confidence > self.high_risk_threshold:
            return FraudPrediction(
                risk_level=RiskLevel.HIGH,
                confidence=rules_result.confidence,
                triggered_rules=rules_result.triggered,
                recommendation=Recommendation.BLOCK
            )
        
        # Layer 2: ML model
        ml_result = self.ml_model.predict(event)
        if ml_result.confidence > self.high_risk_threshold:
            return FraudPrediction(
                risk_level=RiskLevel.HIGH,
                confidence=ml_result.confidence,
                model_scores=ml_result.scores,
                recommendation=Recommendation.REVIEW
            )
            
        # Layer 3: Behavior analysis
        behavior_score = self.behavior_model.analyze(event)
        
        # Layer 4: Network analysis
        network_score = self.network_analyzer.analyze(event)
        
        # Ensemble scoring
        final_score = self.ensemble(
            rules_result.confidence,
            ml_result.confidence,
            behavior_score,
            network_score
        )
        
        risk_level = self.determine_level(final_score)
        
        return FraudPrediction(
            risk_level=risk_level,
            confidence=final_score,
            layers={
                'rules': rules_result.confidence,
                'ml': ml_result.confidence,
                'behavior': behavior_score,
                'network': network_score
            },
            recommendation=self.recommendation(risk_level)
        )
        
    def ensemble(self, rules: float, ml: float, behavior: float, network: float) -> float:
        """Weighted ensemble"""
        weights = {'rules': 0.3, 'ml': 0.4, 'behavior': 0.15, 'network': 0.15}
        return (
            weights['rules'] * rules +
            weights['ml'] * ml +
            weights['behavior'] * behavior +
            weights['network'] * network
        )
        
    def determine_level(self, score: float) -> RiskLevel:
        if score >= self.high_risk_threshold:
            return RiskLevel.HIGH
        elif score >= self.medium_risk_threshold:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW
        
    def recommendation(self, level: RiskLevel) -> Recommendation:
        return {
            RiskLevel.HIGH: Recommendation.BLOCK,
            RiskLevel.MEDIUM: Recommendation.REVIEW,
            RiskLevel.LOW: Recommendation.ALLOW
        }[level]


class RuleBasedDetector:
    """Fast rules engine"""
    
    def evaluate(self, event: Dict) -> RulesResult:
        triggered = []
        score = 0.0
        
        # Check velocity
        if event.get('velocity_high', False):
            triggered.append('velocity')
            score += 0.9
            
        # Check unusual hours  
        hour = event.get('hour', 12)
        if hour < 6 or hour > 23:
            triggered.append('unusual_hours')
            score += 0.4
            
        # Check new device
        if event.get('new_device', False):
            triggered.append('new_device')
            score += 0.3
            
        # Check IP mismatch
        if event.get('ip_mismatch', False):
            triggered.append('ip_mismatch')
            score += 0.6
            
        return RulesResult(triggered=triggered, confidence=min(score, 1.0))


class HybridDetector:
    """ML-based detector"""
    
    def __init__(self):
        self.model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1
        )
        
    def predict(self, event: Dict) -> MLResult:
        # Feature extraction
        features = self.extract_features(event)
        
        # Predict
        prob = self.model.predict_proba([features])[0][1]
        
        return MLResult(confidence=prob, scores={'xgboost': prob})
        
    def extract_features(self, event: Dict) -> List[float]:
        """Extract features from event"""
        return [
            event.get('amount', 0) / 1000000,
            event.get('velocity', 0),
            event.get('account_age_days', 0) / 365,
            1.0 if event.get('has_2fa') else 0.0
        ]


class BehaviorAnalyzer:
    """Behavioral analysis"""
    
    def analyze(self, event: Dict) -> float:
        # Compare to historical patterns
        return 0.2  # Simplified


class GraphAnalyzer:
    """Network/graph analysis"""
    
    def analyze(self, event: Dict) -> float:
        # Analyze transaction graph
        return 0.15  # Simplified


@dataclass
class FraudPrediction:
    risk_level: RiskLevel
    confidence: float
    layers: Dict[str, float] = None
    triggered_rules: List[str] = None
    model_scores: Dict[str, float] = None
    recommendation: Recommendation = Recommendation.ALLOW


@dataclass
class RulesResult:
    triggered: List[str]
    confidence: float


@dataclass  
class MLResult:
    confidence: float
    scores: Dict[str, float]


class RiskLevel(Enum):
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'


class Recommendation(Enum):
    ALLOW = 'allow'
    REVIEW = 'review'  
    BLOCK = 'block'


# =============================================================================
# Quant Research - Backtesting
# =============================================================================

"""
Strategy backtesting engine
"""

class BacktestEngine:
    """Historical backtesting"""
    
    def __init__(self, initial_capital: float = 1000000):
        self.initial_capital = initial_capital
        self.trades = []
        
    def run(self, strategy, data: pd.DataFrame) -> BacktestResults:
        """Run backtest"""
        
        capital = self.initial_capital
        equity_curve = []
        
        for i in range(len(data) - 1):
            signal = strategy.generate_signal(data.iloc[:i+1])
            
            if signal == 'BUY':
                shares = capital / data.iloc[i]['close']
                capital -= shares * data.iloc[i]['close']
                self.trades.append({
                    'entry': data.iloc[i]['close'],
                    'size': shares,
                    'entry_idx': i
                })
            elif signal == 'SELL' and self.trades:
                trade = self.trades.pop()
                pnl = (data.iloc[i]['close'] - trade['entry']) * trade['size']
                capital += trade['size'] * data.iloc[i]['close']
                
            equity_curve.append(capital)
            
        return self.calculate_metrics(equity_curve)
        
    def calculate_metrics(self, equity: List[float]) -> BacktestResults:
        """Calculate performance metrics"""
        
        returns = np.diff(equity) / equity[:-1]
        
        return BacktestResults(
            total_return=(equity[-1] - self.initial_capital) / self.initial_capital,
            sharpe_ratio=np.mean(returns) / np.std(returns) * np.sqrt(252),
            max_drawdown=self.max_drawdown(equity),
            win_rate=self.win_rate(returns),
            profit_factor=self.profit_factor(returns),
            num_trades=len(self.trades)
        )
        
    def max_drawdown(self, equity: List[float]) -> float:
        peak = equity[0]
        max_dd = 0
        for e in equity:
            if e > peak:
                peak = e
            dd = (peak - e) / peak
            max_dd = max(max_dd, dd)
        return max_dd
        
    def win_rate(self, returns: np.ndarray) -> float:
        return (returns > 0).mean()
        
    def profit_factor(self, returns: np.ndarray) -> float:
        gains = returns[returns > 0].sum()
        losses = abs(returns[returns < 0].sum())
        return gains / losses if losses > 0 else float('inf')


@dataclass
class BacktestResults:
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    profit_factor: float
    num_trades: int


if __name__ == '__main__':
    # Quick test
    detector = FraudDetector()
    
    test_event = {
        'amount': 50000,
        'velocity_high': True,
        'hour': 3,
        'new_device': True,
        'ip_mismatch': False
    }
    
    result = detector.predict(test_event)
    print(f"Risk: {result.risk_level.value}, Score: {result.confidence:.2f}")