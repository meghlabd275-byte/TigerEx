"""Fraud Detection"""

class FraudDetector:
    RISK_SCORE = {'high': 80, 'medium': 50, 'low': 20}
    
    async def analyze(self, tx): return {'risk': 20, 'action': 'allow'}
    async def check(self, uid): return {'safe': True}

if __name__ == '__main__': print("Fraud Ready")