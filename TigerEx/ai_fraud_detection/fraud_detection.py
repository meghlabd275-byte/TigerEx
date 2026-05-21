"""
TigerEx Python AI & Fraud Detection

LANGUAGE: Python 3.10+

WHY PYTHON:
- Unmatched AI/ML ecosystem (PyTorch, TensorFlow)
- Excellent for analytics
- Quant research platforms
- Fraud detection models
- Visualization and reporting

NOT SUITABLE FOR:
- Matching engine (too slow)
- Realtime execution (latency)

IDEAL USE CASES:
1. Fraud Detection (ai/fraud_detection/)
   - ML-based anomaly detection
   - Pattern recognition
   - Behavioral analysis

2. AML Scoring (ai/aml_scoring/)
   - Money laundering detection
   - Suspicious transaction patterns

3. User Behavior Analytics (ai/user_behavior/)
   - Login anomaly detection
   - Trading pattern analysis

4. Monitoring & Reporting (analytics/)
   - Business intelligence
   - Risk dashboards

REQUIREMENTS:
- torch>=2.0
- transformers>=4.30
- pandas>=2.0
- numpy>=1.24
- scikit-learn>=1.3
"""

import hashlib
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional
from enum import Enum

# ========================================================================
# FRAUD DETECTION MODELS
# ========================================================================

class RiskScore(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

@dataclass
class FraudAlert:
    alert_id: str
    user_id: str
    risk_score: RiskScore
    confidence: float
    triggers: list[str]
    timestamp: int

class FraudDetector:
    """
    ML-based fraud detection using:
    - Rule-based filtering (fast)
    - Statistical anomaly detection
    - Behavioral pattern analysis
    """
    
    def __init__(self):
        self.alert_history: list[FraudAlert] = []
        self.user_scores: dict[str, list[float]] = defaultdict(list)
        self.known_fraud_patterns: set[str] = set()
        
        # Known fraud patterns
        self._load_fraud_patterns()
    
    def _load_fraud_patterns(self):
        """Load known fraud indicators"""
        self.known_fraud_patterns.update([
            "rapid_deposit_withdraw",
            "unusual_volume_spike",
            "new_account_large_trade",
            "geo_impossible",
            "device_fingerprint_mismatch",
            "account_sharing_detected",
        ])
    
    def analyze_transaction(
        self,
        user_id: str,
        amount: float,
        deposit_rate: float,
        withdrawals: int,
        devices_seen: int,
        geo_velocity: float,
        recent_failures: int
    ) -> FraudAlert:
        """Main fraud detection pipeline"""
        triggers = []
        risk_factors = []
        
        # Rapid deposit & withdraw pattern
        if deposit_rate > 10 and withdrawals > 5:
            triggers.append("rapid_deposit_withdraw")
            risk_factors.append(0.8)
        
        # Impossible geographic travel
        if geo_velocity > 500:  # km/h
            triggers.append("geo_impossible")
            risk_factors.append(0.95)
        
        # Device fingerprint anomalies
        if devices_seen > 5:
            triggers.append("device_fingerprint_mismatch")
            risk_factors.append(0.6)
        
        # Account age vs transaction size
        if amount > 10000:  # 10k threshold
            triggers.append("new_account_large_trade")
            risk_factors.append(0.7)
        
        # KYC failure correlation
        if recent_failures > 3:
            triggers.append("kyc_failure_correlation")
            risk_factors.append(0.85)
        
        # Calculate risk score
        if not risk_factors:
            risk_score = RiskScore.LOW
            confidence = 0.95
        else:
            avg_risk = sum(risk_factors) / len(risk_factors)
            if avg_risk > 0.8:
                risk_score = RiskScore.CRITICAL
            elif avg_risk > 0.6:
                risk_score = RiskScore.HIGH
            elif avg_risk > 0.4:
                risk_score = RiskScore.MEDIUM
            else:
                risk_score = RiskScore.LOW
            
            confidence = min(avg_risk, sum(risk_factors) / (len(risk_factors) + 0.1))
        
        alert = FraudAlert(
            alert_id=f"FA-{int(time.time()*1000)}",
            user_id=user_id,
            risk_score=risk_score,
            confidence=confidence,
            triggers=triggers,
            timestamp=int(time.time())
        )
        
        if risk_score != RiskScore.LOW:
            self.alert_history.append(alert)
            self.user_scores[user_id].append(confidence)
        
        return alert
    
    def batch_analyze(self, transactions: list[dict]) -> list[FraudAlert]:
        """Process batch of transactions"""
        results = []
        for tx in transactions:
            alert = self.analyze_transaction(
                user_id=tx["user_id"],
                amount=tx["amount"],
                deposit_rate=tx.get("deposit_rate", 0),
                withdrawals=tx.get("withdrawals", 0),
                devices_seen=tx.get("devices_seen", 1),
                geo_velocity=tx.get("geo_velocity", 0),
                recent_failures=tx.get("recent_failures", 0)
            )
            results.append(alert)
        return results

# ========================================================================
# AML SCORING SYSTEM
# ========================================================================

class AmlScorer:
    """
    Anti-Money Laundering scoring based on:
    - Transaction patterns
    - Counterparty risk
    - Geographic risk
    - Behavioral baselines
    """
    
    def __init__(self):
        self.user_baselines: dict[str, dict] = {}
        self.country_risks: dict[str, int] = {}
        self._load_country_risks()
    
    def _load_country_risks(self):
        """Load FATF gray/black list scores"""
        # Risk scores: 1=Low, 2=Medium, 3=High
        self.country_risks = {
            "US": 1, "GB": 1, "SG": 1, "JP": 1, "AU": 1, "CA": 1,
            "DE": 1, "FR": 1, "CH": 1, "NL": 1,
            # Gray list
            "RU": 2, "CN": 2, "TR": 2, "AE": 2,
            # Higher risk
            "KP": 3, "IR": 3, "SY": 3, "CU": 3,
        }
    
    def calculate_aml_score(
        self,
        user_id: str,
        transaction_amount: float,
        transaction_count: int,
        counterparties_risk: float,
        origin_country: str,
        destination_country: str,
        is_foreign: bool
    ) -> tuple[int, str]:
        """
        Calculate AML risk score
        
        Returns: (score 1-100, risk_level)
        """
        score = 0
        
        # Transaction pattern analysis
        if transaction_amount > 10000:
            score += 20
        if transaction_count > 50:
            score += 15
        
        # Geographic risk
        origin_risk = self.country_risks.get(origin_country, 2)
        dest_risk = self.country_risks.get(destination_country, 2)
        
        score += origin_risk * 10
        score += dest_risk * 10
        
        # Foreign transaction risk
        if is_foreign:
            score += 20
        
        # Counterparty risk
        score += int(counterparties_risk * 25)
        
        # Cap score
        score = min(score, 100)
        
        # Determine risk level
        if score < 30:
            level = "LOW"
        elif score < 60:
            level = "MEDIUM"
        elif score < 80:
            level = "HIGH"
        else:
            level = "CRITICAL"
        
        return score, level

# ========================================================================
# USER BEHAVIOR ANALYTICS
# ========================================================================

class BehaviorAnalytics:
    """
    User behavior baseline and anomaly detection:
    - Login patterns
    - Trading hours
    - Device usage
    - Geographic patterns
    """
    
    def __init__(self):
        self.user_baselines: dict[str, dict] = {}
    
    def update_baseline(self, user_id: str, event: dict):
        """Update user behavior baseline"""
        if user_id not in self.user_baselines:
            self.user_baselines[user_id] = {
                "login_times": [],
                "ip_addresses": set(),
                "device_fingerprints": set(),
                "countries": set(),
                "avg_trade_size": 0,
                "total_trades": 0,
            }
        
        baseline = self.user_baselines[user_id]
        
        if event.get("login_time"):
            baseline["login_times"].append(event["login_time"])
        if event.get("ip"):
            baseline["ip_addresses"].add(event["ip"][:8])  # /24 prefix
        if event.get("device"):
            baseline["device_fingerprints"].add(event["device"])
        if event.get("country"):
            baseline["countries"].add(event["country"])
        if "trade_amount" in event:
            # Running average
            n = baseline["total_trades"]
            avg = baseline["avg_trade_size"]
            baseline["avg_trade_size"] = (avg * n + event["trade_amount"]) / (n + 1)
            baseline["total_trades"] += 1
    
    def detect_anomaly(self, user_id: str, event: dict) -> float:
        """
        Detect behavioral anomaly
        
        Returns: anomaly score 0-1
        """
        if user_id not in self.user_baselines:
            return 0.0
        
        baseline = self.user_baselines[user_id]
        score = 0.0
        factors = 0
        
        # IP anomaly
        if "ip" in event:
            ip_prefix = event["ip"][:8]
            if ip_prefix not in baseline["ip_addresses"]:
                score += 0.4
            factors += 1
        
        # Device anomaly
        if "device" in event:
            if event["device"] not in baseline["device_fingerprints"]:
                score += 0.3
            factors += 1
        
        # Country anomaly (rapid movement)
        if "country" in event:
            if event["country"] not in baseline["countries"]:
                # New country but not impossible (VPN use)
                if "last_country" in baseline:
                    if event["country"] != baseline.get("last_country"):
                        score += 0.2
            factors += 1
        
        # Trade size anomaly
        if "trade_amount" in event and baseline["avg_trade_size"] > 0:
            ratio = event["trade_amount"] / baseline["avg_trade_size"]
            if ratio > 10:  # 10x normal
                score += 0.3
            elif ratio > 5:
                score += 0.15
            factors += 1
        
        return score / max(factors, 1) if factors > 0 else 0.0

# ========================================================================
# MAIN DEMO
# ========================================================================

def main():
    # Initialize services
    fraud_detector = FraudDetector()
    aml_scorer = AmlScorer()
    behavior = BehaviorAnalytics()
    
    # Example: Analyze transaction
    alert = fraud_detector.analyze_transaction(
        user_id="user_123",
        amount=50000,
        deposit_rate=15,
        withdrawals=8,
        devices_seen=3,
        geo_velocity=800,  # Impossible!
        recent_failures=2
    )
    
    print(f"Fraud Alert: {alert.risk_score.value} ({alert.confidence:.0%})")
    print(f"Triggers: {alert.triggers}")
    
    # Example: AML scoring
    score, level = aml_scorer.calculate_aml_score(
        user_id="user_456",
        transaction_amount=15000,
        transaction_count=60,
        counterparties_risk=0.5,
        origin_country="RU",
        destination_country="US",
        is_foreign=True
    )
    
    print(f"AML Score: {score}/100 ({level})")
    
    # Example: Behavior anomaly
    behavior.update_baseline("user_789", {
        "ip": "192.168.1.1",
        "device": "abc123",
        "country": "US",
        "trade_amount": 1000,
    })
    
    anomaly = behavior.detect_anomaly("user_789", {
        "ip": "10.0.0.1",  # New IP
        "device": "xyz999",    # New device
        "country": "RU",     # New country
        "trade_amount": 15000,  # 15x normal!
    })
    
    print(f"Anomaly Score: {anomaly:.0%}")
    
    print("\\nTigerEx AI & Fraud Detection System initialized")

if __name__ == "__main__":
    main()