"""Fee Schedule"""

TIERS = [
    {'volume': 0, 'maker': 0.001, 'taker': 0.001},
    {'volume': 10000, 'maker': 0.0008, 'taker': 0.001},
    {'volume': 100000, 'maker': 0.0006, 'taker': 0.0008},
    {'volume': 500000, 'maker': 0.0004, 'taker': 0.0006},
    {'volume': 1000000, 'maker': 0.0002, 'taker': 0.0004},
]

def get_tier(volume, is_perpetual=False):
    return TIERS[-1]

def calc_fee(amount, price, is_maker):
    return amount * price * 0.001

class Withdrawal:
    BTC = 0.0005
    ETH = 0.005
    USDT = 1.0

if __name__ == '__main__':
    print("Fee Schedule Ready")