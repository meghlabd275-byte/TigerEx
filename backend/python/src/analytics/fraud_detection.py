#!/usr/bin/env python3
"""
TigerEx Fraud Detection - Python ML Implementation
Machine learning based fraud detection system
"""

from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from enum import Enum
import json
import math

# ============================================================================
# TYPE DEFINITIONS
# ============================================================================

class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class AlertStatus(Enum):
    NEW = "new"
    INVESTIGATING = "investigating"
    CONFIRMED = "confirmed"
    FALSE_POSITIVE = "false_positive"
    RESOLVED = "resolved"

# ============================================================================
# FRAUD INDICATORS
# ============================================================================

@dataclass
class FraudIndicator:
    name: str
    score: float
    weight: float

# ============================================================================
# TRANSACTION
# ============================================================================

@dataclass
class Transaction:
    id: str
    user_id: str
    amount: float
    currency: str
    tx_type: str  # deposit, withdrawal, transfer
    timestamp: datetime
    ip_address: str
    device_fingerprint: str
    location_country: str
    risk_score: float = 0.0

# ============================================================================
# FRAUD ALERT
# ============================================================================

@dataclass
class FraudAlert:
    id: str
    user_id: str
    transaction_id: str
    risk_level: RiskLevel
    indicators: List[str]
    status: AlertStatus
    notes: str = ""
    created_at: datetime = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()

# ============================================================================
# FRAUD DETECTION ENGINE
# ============================================================================

class FraudDetectionEngine:
    """Rule-based fraud screening engine.

    Jurisdiction risk and amount thresholds are configuration, not constants
    baked into the scoring path: pass them in to match the deployment's
    regulatory regime.
    """

    DEFAULT_HIGH_RISK_COUNTRIES = frozenset({'KP', 'IR', 'SY', 'CU'})

    def __init__(self,
                 high_risk_countries: Optional[frozenset] = None,
                 large_amount_threshold: float = 10000.0,
                 elevated_amount_threshold: float = 5000.0,
                 new_account_days: int = 7):
        if large_amount_threshold <= elevated_amount_threshold:
            raise ValueError("large_amount_threshold must exceed elevated_amount_threshold")
        if new_account_days < 0:
            raise ValueError("new_account_days must not be negative")

        self.transactions: List[Transaction] = []
        self.alerts: List[FraudAlert] = []
        self.alert_counter = 0
        self.user_patterns: Dict[str, dict] = {}
        self.high_risk_countries = (
            frozenset(high_risk_countries)
            if high_risk_countries is not None
            else self.DEFAULT_HIGH_RISK_COUNTRIES
        )
        self.large_amount_threshold = large_amount_threshold
        self.elevated_amount_threshold = elevated_amount_threshold
        self.new_account_days = new_account_days

    def register_user(self, user_id: str, created_at: datetime) -> None:
        """Record the account's real creation time so age checks use it."""
        if not user_id:
            raise ValueError("user_id is required")
        pattern = self.user_patterns.setdefault(user_id, {'tx_count': 0, 'total_volume': 0.0})
        pattern['created_at'] = created_at


    def calculate_risk_score(self, tx: Transaction) -> float:
        """Calculate fraud risk score for transaction (0-100)."""
        if tx.amount < 0:
            raise ValueError("transaction amount must not be negative")

        score = 0.0

        # Check 1: Unusual amount against the configured thresholds.
        if tx.amount > self.large_amount_threshold:
            score += 30
        elif tx.amount > self.elevated_amount_threshold:
            score += 15

        # Check 2: Recently created account, using the real creation time.
        pattern = self.user_patterns.get(tx.user_id)
        if pattern and pattern.get('created_at'):
            account_age = (tx.timestamp - pattern['created_at']).total_seconds() / 86400.0
            if account_age < self.new_account_days:
                score += 25

        # Check 3: Jurisdictions flagged by the configured risk list.
        if tx.location_country in self.high_risk_countries:
            score += 50

        # Check 4: Burst of transactions in the preceding minute.
        window_start = tx.timestamp - timedelta(seconds=60)
        recent_count = sum(
            1 for t in self.transactions
            if t.user_id == tx.user_id and window_start <= t.timestamp <= tx.timestamp
        )
        if recent_count > 5:
            score += 20

        # Check 5: The account is using a new device/IP beyond its usual set.
        user_txs = [t for t in self.transactions if t.user_id == tx.user_id]
        if user_txs:
            recent = user_txs[-10:]
            unique_ips = set(t.ip_address for t in recent)
            unique_devices = set(t.device_fingerprint for t in recent)
            if len(unique_ips) > 3 and tx.ip_address not in unique_ips:
                score += 15
            if len(unique_devices) > 3 and tx.device_fingerprint not in unique_devices:
                score += 10

        return min(score, 100.0)
    
    # ========================================================================
    # ANOMALY DETECTION
    # ========================================================================
    
    def detect_anomalies(self, user_id: str) -> List[FraudIndicator]:
        """Detect behavioral anomalies for user"""
        indicators = []
        
        user_txs = [t for t in self.transactions if t.user_id == user_id]
        
        if len(user_txs) < 5:
            return indicators
        
        # Calculate average transaction amount
        amounts = [t.amount for t in user_txs]
        avg_amount = sum(amounts) / len(amounts)
        
        # Check for unusually large transactions
        current_avg = sum(t.amount for t in user_txs[-10:]) / min(10, len(user_txs[-10:]))
        
        if current_avg > avg_amount * 3:
            indicators.append(FraudIndicator(
                name="Unusually Large Transaction",
                score=40,
                weight=1.0
            ))
        
        # Check for unusual location
        locations = set(t.location_country for t in user_txs[-20:])
        if len(locations) > 5:
            indicators.append(FraudIndicator(
                name="Multiple Locations",
                score=30,
                weight=0.8
            ))
        
        # Check for velocity
        if len(user_txs) > 10:
            recent = user_txs[-10:]
            time_diffs = [
                (recent[i].timestamp - recent[i - 1].timestamp).total_seconds()
                for i in range(1, len(recent))
            ]
            avg_time = sum(time_diffs) / len(time_diffs)
            
            if avg_time < 30:  # Less than 30 seconds between transactions
                indicators.append(FraudIndicator(
                    name="High Velocity Trading",
                    score=35,
                    weight=0.9
                ))
        
        return indicators
    
    # ========================================================================
    # TRANSACTION SCREENING
    # ========================================================================
    
    def screen_transaction(self, tx: Transaction) -> tuple:
        """Screen transaction and return risk level + alerts."""
        if tx.amount < 0:
            raise ValueError("transaction amount must not be negative")

        # Score against the history that precedes this transaction, then record it.
        risk_score = self.calculate_risk_score(tx)

        anomalies = self.detect_anomalies(tx.user_id)
        for anomaly in anomalies:
            risk_score += anomaly.score * anomaly.weight

        risk_score = min(risk_score, 100.0)

        self.transactions.append(tx)
        self.learn_user_pattern(tx.user_id, tx)

        tx.risk_score = risk_score

        if risk_score >= 80:
            level = RiskLevel.CRITICAL
        elif risk_score >= 60:
            level = RiskLevel.HIGH
        elif risk_score >= 40:
            level = RiskLevel.MEDIUM
        else:
            level = RiskLevel.LOW

        alert = None
        if level in (RiskLevel.HIGH, RiskLevel.CRITICAL):
            alert = self.create_alert(tx, level, anomalies)

        return level, alert
    
    def create_alert(self, tx: Transaction, level: RiskLevel, 
                       indicators: List[FraudIndicator]) -> FraudAlert:
        """Create fraud alert"""
        self.alert_counter += 1
        
        indicator_names = [i.name for i in indicators]
        
        alert = FraudAlert(
            id=f"ALERT_{self.alert_counter}",
            user_id=tx.user_id,
            transaction_id=tx.id,
            risk_level=level,
            indicators=indicator_names,
            status=AlertStatus.NEW
        )
        
        self.alerts.append(alert)
        return alert
    
    # ========================================================================
    # ALERT MANAGEMENT
    # ========================================================================
    
    def get_alerts(self, status: Optional[AlertStatus] = None) -> List[FraudAlert]:
        """Get alerts, optionally filtered by status"""
        if status is None:
            return self.alerts
        
        return [a for a in self.alerts if a.status == status]
    
    def update_alert_status(self, alert_id: str, status: AlertStatus, notes: str = "") -> bool:
        """Update alert status"""
        for alert in self.alerts:
            if alert.id == alert_id:
                alert.status = status
                if notes:
                    alert.notes = notes
                return True
        return False
    
    def confirm_alert(self, alert_id: str) -> bool:
        """Mark alert as confirmed fraud"""
        return self.update_alert_status(alert_id, AlertStatus.CONFIRMED)
    
    def dismiss_alert(self, alert_id: str, reason: str) -> bool:
        """Dismiss alert as false positive"""
        return self.update_alert_status(alert_id, AlertStatus.FALSE_POSITIVE, reason)
    
    # ========================================================================
    # USER PATTERNS
    # ========================================================================
    
    def learn_user_pattern(self, user_id: str, tx: Transaction) -> None:
        """Update the rolling volume counters for a user from a real transaction."""
        if tx.user_id != user_id:
            raise ValueError("transaction does not belong to the given user_id")

        pattern = self.user_patterns.setdefault(user_id, {'tx_count': 0, 'total_volume': 0.0})
        pattern['tx_count'] += 1
        pattern['total_volume'] += tx.amount
    
    # ========================================================================
    # STATISTICS
    # ========================================================================
    
    def get_stats(self) -> dict:
        """Get fraud detection statistics"""
        total_alerts = len(self.alerts)
        confirmed_fraud = sum(1 for a in self.alerts if a.status == AlertStatus.CONFIRMED)
        false_positives = sum(1 for a in self.alerts if a.status == AlertStatus.FALSE_POSITIVE)
        
        return {
            'total_transactions': len(self.transactions),
            'total_alerts': total_alerts,
            'confirmed_fraud': confirmed_fraud,
            'false_positives': false_positives,
            'alert_rate': total_alerts / len(self.transactions) if self.transactions else 0,
            'precision': confirmed_fraud / total_alerts if total_alerts else 0,
        }


# ============================================================================
# MAIN EXAMPLE
# ============================================================================

def _self_test() -> None:
    """Exercises the fraud engine with explicit fixture transactions."""
    now = datetime.now()
    engine = FraudDetectionEngine()

    # A freshly created account: age checks must use the real creation time.
    engine.register_user("user1", now - timedelta(days=1))
    engine.register_user("user2", now - timedelta(days=365))

    transactions = [
        Transaction("tx1", "user1", 500.0, "USDT", "deposit",
                    now, "192.168.1.1", "fp123", "US"),
        Transaction("tx2", "user2", 15000.0, "USDT", "withdrawal",
                    now, "10.0.0.1", "fp456", "US"),
        Transaction("tx3", "user1", 2000.0, "USDT", "transfer",
                    now, "192.168.1.1", "fp123", "US"),
        # Sanctioned jurisdiction: must raise a high/critical alert.
        Transaction("tx4", "user1", 100.0, "USDT", "deposit",
                    now, "192.168.1.1", "fp123", "KP"),
    ]

    for tx in transactions:
        level, alert = engine.screen_transaction(tx)
        if alert:
            assert alert.id.startswith("ALERT_")
            assert alert.transaction_id == tx.id
            assert alert.risk_level == level

    assert engine.get_alerts()[0].transaction_id == "tx4"

    # A negative amount is rejected rather than scored.
    try:
        engine.screen_transaction(Transaction(
            "bad", "user1", -1.0, "USDT", "deposit",
            now, "192.168.1.1", "fp123", "US"))
        raise AssertionError("negative amount must be rejected")
    except ValueError:
        pass

    stats = engine.get_stats()
    assert stats['total_transactions'] == 4, stats
    print("fraud detection self-test passed")



if __name__ == "__main__":
    _self_test()