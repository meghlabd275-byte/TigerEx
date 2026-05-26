#!/usr/bin/env python3
"""
TigerEx Fraud Detection - Python ML Implementation
Machine learning based fraud detection system
"""

from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import datetime
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
    def __init__(self):
        self.transactions: List[Transaction] = []
        self.alerts: List[FraudAlert] = []
        self.alert_counter = 0
        self.user_patterns: Dict[str, dict] = {}
        
    # ========================================================================
    # RISK SCORING
    # ========================================================================
    
    def calculate_risk_score(self, tx: Transaction) -> float:
        """Calculate fraud risk score for transaction"""
        score = 0.0
        
        # Check 1: Unusual amount
        if tx.amount > 10000:
            score += 30
        elif tx.amount > 5000:
            score += 15
        
        # Check 2: New account (simplified)
        if tx.user_id in self.user_patterns:
            account_age = (datetime.now() - self.user_patterns[tx.user_id].get('created_at', datetime.now())).days
            if account_age < 7:
                score += 25
        
        # Check 3: High risk countries (simplified list)
        high_risk_countries = ['KP', 'IR', 'SY', 'CU']
        if tx.location_country in high_risk_countries:
            score += 50
        
        # Check 4: Multiple transactions in short time
        recent_count = sum(1 for t in self.transactions[-100:] 
                          if t.user_id == tx.user_id and 
                          (tx.timestamp - t.timestamp).seconds < 60)
        if recent_count > 5:
            score += 20
        
        # Check 5: IP address changes
        user_txs = [t for t in self.transactions if t.user_id == tx.user_id]
        if user_txs:
            unique_ips = set(t.ip_address for t in user_txs[-10:])
            if tx.ip_address not in unique_ips and len(unique_ips) > 3:
                score += 15
        
        # Cap at 100
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
            time_diffs = [(recent[i].timestamp - recent[i-1].timestamp).seconds 
                         for i in range(1, len(recent))]
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
        """Screen transaction and return risk level + alerts"""
        # Calculate base risk score
        risk_score = self.calculate_risk_score(tx)
        tx.risk_score = risk_score
        
        # Store transaction
        self.transactions.append(tx)
        
        # Get behavioral anomalies
        anomalies = self.detect_anomalies(tx.user_id)
        
        # Add anomaly scores
        for anomaly in anomalies:
            risk_score += anomaly.score * anomaly.weight
        
        risk_score = min(risk_score, 100.0)
        tx.risk_score = risk_score
        
        # Determine risk level
        if risk_score >= 80:
            level = RiskLevel.CRITICAL
        elif risk_score >= 60:
            level = RiskLevel.HIGH
        elif risk_score >= 40:
            level = RiskLevel.MEDIUM
        else:
            level = RiskLevel.LOW
        
        # Create alert for high risk
        alert = None
        if level in [RiskLevel.HIGH, RiskLevel.CRITICAL]:
            alert = self.create_alert(tx, level, anomalies)
        
        return level, alert
    
    def create_alalert(self, tx: Transaction, level: RiskLevel, 
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
    
    def learn_user_pattern(self, user_id: str, pattern_data: dict):
        """Learn user behavior patterns"""
        if user_id not in self.user_patterns:
            self.user_patterns[user_id] = {
                'created_at': datetime.now(),
                'tx_count': 0,
                'total_volume': 0.0,
            }
        
        self.user_patterns[user_id]['tx_count'] += 1
        self.user_patterns[user_id]['total_volume'] += pattern_data.get('amount', 0)
    
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

def main():
    engine = FraudDetectionEngine()
    
    # Simulate transactions
    transactions = [
        Transaction("tx1", "user1", 500.0, "USDT", "deposit", 
                   datetime.now(), "192.168.1.1", "fp123", "US"),
        Transaction("tx2", "user2", 15000.0, "USDT", "withdrawal",
                   datetime.now(), "10.0.0.1", "fp456", "US"),
        Transaction("tx3", "user1", 2000.0, "USDT", "transfer",
                   datetime.now(), "192.168.1.1", "fp123", "US"),
    ]
    
    # Screen transactions
    for tx in transactions:
        level, alert = engine.screen_transaction(tx)
        print(f"Transaction {tx.id}: {level.value} (score: {tx.risk_score:.1f})")
        
        if alert:
            print(f"  ALERT: {alert.id} - {alert.indicators}")
    
    # Get stats
    stats = engine.get_stats()
    print(f"\nStatistics: {json.dumps(stats, indent=2, default=str)}")

if __name__ == "__main__":
    main()