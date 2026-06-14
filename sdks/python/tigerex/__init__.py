"""
TigerEx Python SDK
Production-grade Python SDK for TigerEx exchange API
"""

import hashlib
import hmac
import time
import requests
from typing import Dict, List, Optional, Any
from urllib.parse import urlencode


class TigerExClient:
    """TigerEx API Client"""
    
    BASE_URL = "https://api.tigerex.com"
    TEST_URL = "https://api-test.tigerex.com"
    
    def __init__(self, api_key: str = "", api_secret: str = "", testnet: bool = False):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = self.TEST_URL if testnet else self.BASE_URL
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "User-Agent": "TigerEx-Python-SDK/1.0.0"
        })
    
    def _sign(self, params: Dict) -> str:
        """Generate HMAC SHA256 signature"""
        query = urlencode(sorted(params.items()))
        signature = hmac.new(
            self.api_secret.encode(),
            query.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def _request(self, method: str, endpoint: str, params: Dict = None, signed: bool = False) -> Dict:
        """Make API request"""
        url = f"{self.base_url}{endpoint}"
        headers = {}
        
        if self.api_key:
            headers["X-MEX-APIKEY"] = self.api_key
        
        if signed and params:
            params["timestamp"] = int(time.time() * 1000)
            params["signature"] = self._sign(params)
        
        if method == "GET":
            response = self.session.get(url, params=params, headers=headers)
        elif method == "POST":
            response = self.session.post(url, json=params, headers=headers)
        elif method == "DELETE":
            response = self.session.delete(url, params=params, headers=headers)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        response.raise_for_status()
        return response.json()
    
    # =========================================================================
    # MARKET DATA
    # =========================================================================
    
    def ping(self) -> Dict:
        """Test connectivity"""
        return self._request("GET", "/api/v3/ping")
    
    def time(self) -> Dict:
        """Get server time"""
        return self._request("GET", "/api/v3/time")
    
    def exchange_info(self, symbol: str = "") -> Dict:
        """Get exchange info"""
        params = {"symbol": symbol} if symbol else {}
        return self._request("GET", "/api/v3/exchangeInfo", params)
    
    def ticker_price(self, symbol: str) -> Dict:
        """Get price for symbol"""
        return self._request("GET", "/api/v3/ticker/price", {"symbol": symbol})
    
    def ticker_24h(self, symbol: str = "") -> Dict:
        """Get 24h ticker"""
        params = {"symbol": symbol} if symbol else {}
        return self._request("GET", "/api/v3/ticker/24hr", params)
    
    def book_ticker(self, symbol: str) -> Dict:
        """Get book ticker"""
        return self._request("GET", "/api/v3/ticker/bookTicker", {"symbol": symbol})
    
    def depth(self, symbol: str, limit: int = 100) -> Dict:
        """Get order book depth"""
        return self._request("GET", "/api/v3/depth", {"symbol": symbol, "limit": limit})
    
    def trades(self, symbol: str, limit: int = 500) -> Dict:
        """Get recent trades"""
        return self._request("GET", "/api/v3/trades", {"symbol": symbol, "limit": limit})
    
    def klines(self, symbol: str, interval: str = "1m", limit: int = 500) -> List:
        """Get klines/candlesticks"""
        return self._request("GET", "/api/v3/klines", {
            "symbol": symbol,
            "interval": interval,
            "limit": limit
        })
    
    def avg_price(self, symbol: str, minutes: int = 5) -> Dict:
        """Get average price"""
        return self._request("GET", "/api/v3/avgPrice", {
            "symbol": symbol,
            "minutes": minutes
        })
    
    # =========================================================================
    # ACCOUNT
    # =========================================================================
    
    def account(self) -> Dict:
        """Get account info"""
        return self._request("GET", "/api/v3/account", signed=True)
    
    def my_trades(self, symbol: str, **kwargs) -> List:
        """Get my trades"""
        params = {"symbol": symbol, **kwargs}
        return self._request("GET", "/api/v3/myTrades", params, signed=True)
    
    # =========================================================================
    # ORDERS
    # =========================================================================
    
    def order(self, symbol: str, order_id: int = None, orig_client_order_id: str = None) -> Dict:
        """Get order by ID"""
        params = {"symbol": symbol}
        if order_id:
            params["orderId"] = order_id
        if orig_client_order_id:
            params["origClientOrderId"] = orig_client_order_id
        return self._request("GET", "/api/v3/order", params, signed=True)
    
    def open_orders(self, symbol: str = "") -> List:
        """Get open orders"""
        params = {"symbol": symbol} if symbol else {}
        return self._request("GET", "/api/v3/openOrders", params, signed=True)
    
    def all_orders(self, symbol: str, **kwargs) -> List:
        """Get all orders"""
        params = {"symbol": symbol, **kwargs}
        return self._request("GET", "/api/v3/allOrders", params, signed=True)
    
    def create_order(self, **kwargs) -> Dict:
        """Create new order"""
        return self._request("POST", "/api/v3/order", kwargs, signed=True)
    
    def cancel_order(self, symbol: str, order_id: int = None, orig_client_order_id: str = None) -> Dict:
        """Cancel order"""
        params = {"symbol": symbol}
        if order_id:
            params["orderId"] = order_id
        if orig_client_order_id:
            params["origClientOrderId"] = orig_client_order_id
        return self._request("DELETE", "/api/v3/order", params, signed=True)
    
    # =========================================================================
    # SPOT TRADING
    # =========================================================================
    
    def buy_limit(self, symbol: str, quantity: float, price: float, **kwargs) -> Dict:
        """Place limit buy order"""
        return self.create_order(
            symbol=symbol,
            side="BUY",
            type="LIMIT",
            quantity=quantity,
            price=price,
            **kwargs
        )
    
    def sell_limit(self, symbol: str, quantity: float, price: float, **kwargs) -> Dict:
        """Place limit sell order"""
        return self.create_order(
            symbol=symbol,
            side="SELL",
            type="LIMIT",
            quantity=quantity,
            price=price,
            **kwargs
        )
    
    def buy_market(self, symbol: str, quantity: float, **kwargs) -> Dict:
        """Place market buy order"""
        return self.create_order(
            symbol=symbol,
            side="BUY",
            type="MARKET",
            quantity=quantity,
            **kwargs
        )
    
    def sell_market(self, symbol: str, quantity: float, **kwargs) -> Dict:
        """Place market sell order"""
        return self.create_order(
            symbol=symbol,
            side="SELL",
            type="MARKET",
            quantity=quantity,
            **kwargs
        )
    
    # =========================================================================
    # MARGIN TRADING
    # =========================================================================
    
    def margin_account(self) -> Dict:
        """Get margin account info"""
        return self._request("GET", "/sapi/v3/margin/account", signed=True)
    
    def create_margin_order(self, **kwargs) -> Dict:
        """Create margin order"""
        return self._request("POST", "/sapi/v3/margin/order", kwargs, signed=True)
    
    # =========================================================================
    # FUTURES
    # =========================================================================
    
    def futures_account(self) -> Dict:
        """Get futures account info"""
        return self._request("GET", "/fapi/v3/account", signed=True)
    
    def futures_position(self, symbol: str = "") -> List:
        """Get futures positions"""
        params = {"symbol": symbol} if symbol else {}
        return self._request("GET", "/fapi/v3/position", params, signed=True)
    
    def create_futures_order(self, **kwargs) -> Dict:
        """Create futures order"""
        return self._request("POST", "/fapi/v3/order", kwargs, signed=True)
    
    # =========================================================================
    # WALLET
    # =========================================================================
    
    def deposit_address(self, coin: str, network: str = "") -> Dict:
        """Get deposit address"""
        params = {"coin": coin}
        if network:
            params["network"] = network
        return self._request("GET", "/api/v3/deposit/address", params, signed=True)
    
    def deposit_history(self, **kwargs) -> List:
        """Get deposit history"""
        return self._request("GET", "/api/v3/deposit/history", kwargs, signed=True)
    
    def withdraw(self, coin: str, address: str, amount: float, network: str = "", **kwargs) -> Dict:
        """Withdraw funds"""
        params = {
            "coin": coin,
            "address": address,
            "amount": amount,
            "network": network,
            **kwargs
        }
        return self._request("POST", "/api/v3/withdraw", params, signed=True)
    
    def withdraw_history(self, **kwargs) -> List:
        """Get withdrawal history"""
        return self._request("GET", "/api/v3/withdraw/history", kwargs, signed=True)
    
    # =========================================================================
    # USER DATA
    # =========================================================================
    
    def api_key_permissions(self) -> Dict:
        """Get API key permissions"""
        return self._request("GET", "/api/v3/apiKeyPermission", signed=True)
    
    def rate_limit_order(self) -> Dict:
        """Get order rate limit"""
        return self._request("GET", "/api/v3/rateLimit/order", signed=True)


class WebSocketClient:
    """TigerEx WebSocket Client"""
    
    STREAM_URL = "wss://stream.tigerex.com/ws"
    TEST_STREAM_URL = "wss://stream-test.tigerex.com/ws"
    
    def __init__(self, on_message=None, testnet: bool = False):
        self.url = self.TEST_STREAM_URL if testnet else self.STREAM_URL
        self.on_message = on_message
        self.ws = None
        self.subscriptions = set()
    
    def connect(self):
        """Connect to WebSocket"""
        pass
    
    def disconnect(self):
        """Disconnect from WebSocket"""
        pass
    
    def subscribe(self, streams: List[str]):
        """Subscribe to streams"""
        for stream in streams:
            self.subscriptions.add(stream)
    
    def unsubscribe(self, streams: List[str]):
        """Unsubscribe from streams"""
        for stream in streams:
            self.subscriptions.discard(stream)


# =========================================================================
# CONVENIENCE FUNCTIONS
# =========================================================================

def create_client(api_key: str = "", api_secret: str = "", testnet: bool = False) -> TigerExClient:
    """Create TigerEx client"""
    return TigerExClient(api_key, api_secret, testnet)


def create_websocket_client(on_message=None, testnet: bool = False) -> WebSocketClient:
    """Create WebSocket client"""
    return WebSocketClient(on_message, testnet)


# =========================================================================
# EXCEPTIONS
# =========================================================================

class TigerExException(Exception):
    """Base exception"""
    pass


class APIException(TigerExException):
    """API exception"""
    def __init__(self, response: Dict):
        self.code = response.get("code", -1)
        self.message = response.get("msg", "")
        super().__init__(f"{self.code}: {self.message}")


# =========================================================================
# VERSION
# =========================================================================

__version__ = "1.0.0"
__author__ = "TigerEx Team"