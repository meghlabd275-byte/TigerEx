"""External Exchange Feeds"""

class BinanceFeed:
    async def connect(self, symbols): return {'connected': True}
    async def ticker(self, symbol): return {'price': 50000}
    async def depth(self, symbol): return {'bids': [], 'asks': []}


class CoinbaseFeed:
    async def ticker(self, symbol): return {'price': 49999}


class Aggregator:
    async def aggregate(self, symbol):
        return {'price': 50000, 'sources': 3}


if __name__ == '__main__':
    print("Feeds Ready")