#!/usr/bin/env python3
"""Account Freeze Handler"""

class Freeze:
    FROZEN = "frozen"
    ACTIVE = "active"
    
    def __init__(self):
        self.accounts = {}
    
    def freeze(self, uid, reason):
        self.accounts[uid] = {"status": self.FROZEN, "reason": reason}
    
    def unfreeze(self, uid):
        if uid in self.accounts:
            self.accounts[uid]["status"] = self.ACTIVE
    
    def is_frozen(self, uid):
        return self.accounts.get(uid, {}).get("status") == self.FROZEN

f = Freeze()
f.freeze("user1", "Suspicious activity")