#!/usr/bin/env python3
"""Social Trading Module"""

class SocialTrading:
    def __init__(self):
        self.followers = {}
        self.traders = {}
    
    def register_trader(self, user_id, return_pct):
        self.traders[user_id] = {"return": return_pct}
        return True
    
    def start_copy(self, master, follower, ratio):
        if master in self.traders:
            self.followers[follower] = master
            return True
        return False
    
    def get_leaderboard(self):
        return sorted(self.traders.items(), key=lambda x: x[1]["return"], reverse=True)

if __name__ == "__main__":
    st = SocialTrading()
    st.register_trader("trader1", 150.5)
    st.start_copy("trader1", "user2", 0.5)
    print("Leaderboard:", st.get_leaderboard())