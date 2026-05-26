#!/usr/bin/env python3
"""Crypto Utils"""

import hashlib
import hmac
import base64

def sha256(data):
    return hashlib.sha256(data.encode()).hexdigest()

def hmac_sha256(key, data):
    return hmac.new(key.encode(), data.encode(), hashlib.sha256).hexdigest()

def encode_base64(data):
    return base64.b64encode(data.encode()).decode()

def decode_base64(data):
    return base64.b64decode(data.encode()).decode()

print(sha256("test"))