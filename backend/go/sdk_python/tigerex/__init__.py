#!/usr/bin/env python3
"""
TigerEx Python SDK - Official Trading Library
Production-grade Python SDK for TigerEx exchange API
"""

import hashlib
import hmac
import time
import requests
import json
from typing import Optional, Dict, List, Any
from datetime import datetime
from urllib.parse import urlencode

__version__ = "1.0.0"
__author__ = "TigerEx Trading Team"

class TigerExException(Exception):
    """Base exception for TigerEx SDK"""
    pass

class TigerExAPIException(TigerExException):
    """API error response"""
    def __init__(self, response: Dict[str, Any]):
        self.code = response.get('code', -1)
        self.message = response.get('msg', 'Unknown error')
        super().__init__(f"API Error {self.code}: {self.message}")

class TigerExClient:
    """TigerEx API Client"""
    
    BASE_URL = "https://api.tigerex.com"
    TESTNET_URL = "https://testnet-api.tigerex.com"
    
    def __init__(self, api_key=None, api_secret=None, testnet=False, timeout=30):
        self.api_key = api_key
        self.api_secret = api_secret
        self.testnet = testnet
        self.timeout = timeout
        self.base_url = self.TESTNET_URL if testnet else self.BASE_URL
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "User-Agent": f"TigerEx-Python-SDK/{__version__}",
        })
    
    def _generate_signature(self, params: Dict) -> str:
        query_string = urlencode(sorted(params.items()))
        return hmac.new(
            self.api_secret.encode('utf-8'),
            query_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
    
    def _request(self, method, endpoint, params=None, signed=False):
        url = f"{self.base_url}{endpoint}"
        headers = {"Content-Type": "application/json"}
        
        if self.api_key:
            headers["X-TigerEx-API-Key"] = self.api_key
        
        if signed and params is None:
            params = {}
        if signed:
            params["timestamp"] = int(time.time() * 1000)
            params["signature"] = self._generate_signature(params)
        
        try:
            if method == "GET":
                r = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
            elif method == "POST":
                r = self.session.post(url, json=params, headers=headers, timeout=self.timeout)
            elif method == "DELETE":
                r = self.session.delete(url, params=params, headers=headers, timeout=self.timeout)
            else:
                raise TigerExException(f"Unsupported method: {method}")
            
            if r.status_code == 200:
                data = r.json()
                if data.get('code', 0) != 0:
                    raise TigerExAPIException(data)
                return data
            else:
                r.raise_for_status()
        except requests.exceptions.Timeout:
            raise TigerExException("Request timeout")
    
    def ping(self):
        return self._request("GET", "/api/v3/ping")
    
    def get_server_time(self):
        data = self._request("GET", "/api/v3/time")
        return data.get('serverTime', 0)
    
    def get_exchange_info(self):
        return self._request("GET", "/api/v3/exchangeInfo")
    
    # Spot Trading
    def new_order(self, symbol, side, order_type, quantity, price=None, stop_price=None):
        params = {
            "symbol": symbol.upper(),
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": str(quantity),
        }
        if price:
            params["price"] = str(price)
        if stop_price:
            params["stopPrice"] = str(stop_price)
        return self._request("POST", "/api/v3/order", params, signed=True)
    
    def cancel_order(self, symbol, order_id=None, client_order_id=None):
        params = {"symbol": symbol.upper()}
        if order_id:
            params["orderId"] = order_id
        if client_order_id:
            params["origClientOrderId"] = client_order_id
        return self._request("DELETE", "/api/v3/order", params, signed=True)
    
    def get_order(self, symbol, order_id=None, client_order_id=None):
        params = {"symbol": symbol.upper()}
        if order_id:
            params["orderId"] = order_id
        if client_order_id:
            params["origClientOrderId"] = client_order_id
        return self._request("GET", "/api/v3/order", params, signed=True)
    
    def get_open_orders(self, symbol=None):
        params = {}
        if symbol:
            params["symbol"] = symbol.upper()
        return self._request("GET", "/api/v3/openOrders", params, signed=True)
    
    def get_account(self):
        return self._request("GET", "/api/v3/account", signed=True)
    
    def get_balance(self, asset=None):
        params = {}
        if asset:
            params["asset"] = asset.upper()
        return self._request("GET", "/api/v3/balance", params, signed=True)
    
    def get_trades(self, symbol, limit=500):
        return self._request("GET", "/api/v3/myTrades", {"symbol": symbol.upper(), "limit": limit}, signed=True)
    
    # Market Data
    def get_ticker(self, symbol):
        return self._request("GET", "/api/v3/ticker/24hr", {"symbol": symbol.upper()})
    
    def get_order_book(self, symbol, limit=100):
        return self._request("GET", "/api/v3/depth", {"symbol": symbol.upper(), "limit": limit})
    
    def get_recent_trades(self, symbol, limit=500):
        return self._request("GET", "/api/v3/trades", {"symbol": symbol.upper(), "limit": limit})
    
    def get_klines(self, symbol, interval, limit=500):
        return self._request("GET", "/api/v3/klines", {"symbol": symbol.upper(), "interval": interval, "limit": limit})
    
    # Margin Trading
    def margin_get_account(self):
        return self._request("GET", "/sapi/v1/margin/account", signed=True)
    
    def margin_borrow(self, asset, amount):
        return self._request("POST", "/sapi/v1/margin/borrow", {"asset": asset.upper(), "amount": str(amount)}, signed=True)
    
    def margin_repay(self, asset, amount):
        return self._request("POST", "/sapi/v1/margin/repay", {"asset": asset.upper(), "amount": str(amount)}, signed=True)
    
    def margin_new_order(self, symbol, side, order_type, quantity, price=None, margin_type="ISOLATED"):
        params = {
            "symbol": symbol.upper(),
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": str(quantity),
            "marginType": margin_type.upper(),
        }
        if price:
            params["price"] = str(price)
        return self._request("POST", "/sapi/v1/margin/order", params, signed=True)
    
    def margin_set_leverage(self, symbol, leverage):
        return self._request("POST", "/sapi/v1/margin/leverage", {"symbol": symbol.upper(), "leverage": leverage}, signed=True)
    
    def margin_get_positions(self, symbol=None):
        params = {}
        if symbol:
            params["symbol"] = symbol.upper()
        return self._request("GET", "/sapi/v1/margin/positionRisk", params, signed=True)
    
    # Futures Trading
    def futures_get_account(self):
        return self._request("GET", "/fapi/v2/account", signed=True)
    
    def futures_new_order(self, symbol, side, order_type, quantity, price=None, position_side="BOTH"):
        params = {
            "symbol": symbol.upper(),
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": str(quantity),
            "positionSide": position_side.upper(),
        }
        if price:
            params["price"] = str(price)
        return self._request("POST", "/fapi/v2/order", params, signed=True)
    
    def futures_set_leverage(self, symbol, leverage):
        return self._request("POST", "/fapi/v2/leverage", {"symbol": symbol.upper(), "leverage": leverage}, signed=True)
    
    def futures_get_positions(self, symbol=None):
        params = {}
        if symbol:
            params["symbol"] = symbol.upper()
        return self._request("GET", "/fapi/v2/position", params, signed=True)
    
    def futures_get_funding_rate(self, symbol):
        return self._request("GET", "/fapi/v1/fundingRate", {"symbol": symbol.upper()})
    
    def futures_get_open_interest(self, symbol):
        return self._request("GET", "/fapi/v1/openInterest", {"symbol": symbol.upper()})
    
    # Wallet
    def get_deposit_address(self, coin, network=None):
        params = {}
        if network:
            params["network"] = network
        return self._request("GET", f"/api/v3/capital/deposit/address/{coin}", params, signed=True)
    
    def get_deposit_history(self, coin=None, limit=100):
        params = {"limit": limit}
        if coin:
            params["coin"] = coin.upper()
        return self._request("GET", "/api/v3/capital/deposit", params, signed=True)
    
    def withdraw(self, coin, address, amount, network=None, address_tag=None):
        params = {
            "coin": coin.upper(),
            "address": address,
            "amount": str(amount),
        }
        if network:
            params["network"] = network
        if address_tag:
            params["addressTag"] = address_tag
        return self._request("POST", "/api/v3/capital/withdraw", params, signed=True)
    
    def get_withdraw_history(self, coin=None, limit=100):
        params = {"limit": limit}
        if coin:
            params["coin"] = coin.upper()
        return self._request("GET", "/api/v3/capital/withdraw", params, signed=True)
    
    def transfer(self, asset, amount, from_account, to_account):
        return self._request("POST", "/api/v3/capital/transfer", {
            "asset": asset.upper(),
            "amount": str(amount),
            "fromAccount": from_account.lower(),
            "toAccount": to_account.lower(),
        }, signed=True)
    
    # Staking
    def get_staking_products(self, asset=None):
        params = {}
        if asset:
            params["asset"] = asset.upper()
        return self._request("GET", "/sapi/v1/staking/product", params, signed=True)
    
    def stake(self, asset, amount, lock_period=30):
        return self._request("POST", "/sapi/v1/staking/stake", {
            "asset": asset.upper(),
            "amount": str(amount),
            "lockPeriod": lock_period,
        }, signed=True)
    
    def unstake(self, asset, amount):
        return self._request("POST", "/sapi/v1/staking/unstake", {"asset": asset.upper(), "amount": str(amount)}, signed=True)
    
    # Lending
    def get_lending_rates(self, asset=None):
        params = {}
        if asset:
            params["asset"] = asset.upper()
        return self._request("GET", "/sapi/v1/lending/dailyRate", params, signed=True)
    
    def lending_position(self, asset, amount):
        return self._request("POST", "/sapi/v1/lending/position", {"asset": asset.upper(), "amount": str(amount)}, signed=True)
    
    # KYC
    def submit_kyc(self, first_name, last_name, date_of_birth, nationality, document_type, document_number, document_country, address, city, postal_code, country):
        return self._request("POST", "/api/v1/kyc/applications", {
            "firstName": first_name,
            "lastName": last_name,
            "dateOfBirth": date_of_birth,
            "nationality": nationality.upper(),
            "documentType": document_type.lower(),
            "documentNumber": document_number,
            "documentCountry": document_country.upper(),
            "address": address,
            "city": city,
            "postalCode": postal_code,
            "country": country.upper(),
        }, signed=True)
    
    def get_kyc_status(self):
        return self._request("GET", "/api/v1/kyc/status", signed=True)
    
    def get_tier_limits(self):
        return self._request("GET", "/api/v1/kyc/tier-limits")

def create_client(api_key=None, api_secret=None, testnet=False):
    return TigerExClient(api_key, api_secret, testnet)

if __name__ == "__main__":
    client = create_client()
    print("Ping:", client.ping())
    print("Server Time:", client.get_server_time())