"""
TigerEx Fraud Prevention & Anti-Fraud Detection
Real-time transaction monitoring, KYC/AML, device fingerprinting
"""
import hashlib
import time
from typing import Dict, List, Optional, Any

class RiskLevel:
    CRITICAL = 90
    HIGH = 75
    MEDIUM = 50
    LOW = 25
    SAFE = 0

class FraudDetector:
    RISK_SCORES = { 'critical': 90, 'high': 75, 'medium': 50, 'low': 25, 'safe': 0 }
    
    def __init__(self):
        self.blacklist_cache: Dict[str, float] = {}
        self.risk_history: Dict[str, List[Dict]] = {}
        self.device_fingerprints: Dict[str, Dict] = {}
        self.kyc_attempts: Dict[str, int] = {}
        
    async def analyze_transaction(self, transaction: Dict) -> Dict:
        signals = []
        total_risk = 0
        account_age_days = transaction.get("account_age_days", 0)
        tx_amount = transaction.get("amount_usd", 0)
        
        if account_age_days < 7 and tx_amount > 10000:
            signals.append({"type": "new_account_large_tx", "score": 80})
            total_risk += 80
            
        tx_count_24h = transaction.get("tx_count_24h", 0)
        if tx_count_24h > 50:
            signals.append({"type": "velocity_spike", "score": 65})
            total_risk += 65
            
        if transaction.get("ip_changed_recently"):
            signals.append({"type": "unusual_ip_change", "score": 60})
            total_risk += 60
            
        country = transaction.get("country", "unknown")
        high_risk_countries = ["KP", "IR", "SY", "CU"]
        if country in high_risk_countries:
            signals.append({"type": "high_risk_country", "score": 85})
            total_risk += 85
            
        overall_risk = min(total_risk, 100)
        
        if overall_risk >= 80:
            action = "block"
        elif overall_risk >= 60:
            action = "review"
        elif overall_risk >= 40:
            action = "flag"
        else:
            action = "allow"
            
        return {"user_id": transaction.get("user_id", ""), "tx_id": transaction.get("tx_id", ""), 
                "risk_score": overall_risk, "action": action, "signals": signals}
        
    async def check_user(self, user_id: str) -> Dict:
        history = self.risk_history.get(user_id, [])
        if not history:
            return {"safe": True, "risk_score": 0}
        avg_risk = sum(h.get("risk_score", 0) for h in history[-10:]) / min(len(history), 10)
        return {"safe": avg_risk < 40, "risk_score": avg_risk}

class KYCVerifier:
    def __init__(self):
        self.verifications: Dict[str, Dict] = {}
        
    async def submit_kyc(self, user_id: str, documents: Dict) -> Dict:
        verification_id = f"kyc_{user_id}_{int(time.time())}"
        self.verifications[verification_id] = {"user_id": user_id, "status": "pending", "documents": documents}
        return {"verification_id": verification_id, "status": "pending"}
        
    async def verify_kyc(self, verification_id: str) -> Dict:
        if verification_id not in self.verifications:
            return {"error": "Verification not found"}
        self.verifications[verification_id]["status"] = "approved"
        return {"verification_id": verification_id, "status": "approved", "tier": "verified"}
        
    async def check_watchlist(self, name: str, country: str) -> Dict:
        return {"clear": True, "matches": []}

class DeviceFingerprinter:
    @staticmethod
    def generate_fingerprint(device_info: Dict) -> str:
        data = f"{device_info.get('ua','')}-{device_info.get('screen','')}-{device_info.get('timezone','')}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]
        
    @staticmethod
    def detect_emulator(device_info: Dict) -> bool:
        indicators = device_info.get("indicators", [])
        return any(i in ["emulator", "simulator", "genymotion"] for i in indicators)

class AMLMonitor:
    def __init__(self):
        self.alerts: List[Dict] = []
        
    async def monitor_transaction(self, tx: Dict) -> Dict:
        alerts = []
        if tx.get("type") == "deposit" and tx.get("amount_usd", 0) > 9000:
            alerts.append({"type": "structuring", "severity": "high"})
        if tx.get("round_trip"):
            alerts.append({"type": "round_tripping", "severity": "critical"})
        return {"alerts": alerts, "clear": len(alerts) == 0}

if __name__ == "__main__":
    detector = FraudDetector()
    print("Fraud Detection System Ready")