#!/usr/bin/env python3
"""Serialization Module"""

import json
import pickle
import base64

class Serializer:
    @staticmethod
    def to_json(obj):
        return json.dumps(obj)
    
    @staticmethod
    def from_json(data):
        return json.loads(data)
    
    @staticmethod
    def to.binary(obj):
        return base64.b64encode(pickle.dumps(obj)).decode()
    
    @staticmethod
    def from_binary(data):
        return pickle.loads(base64.b64decode(data))

s = Serializer()
data = {"key": "value", "count": 42}
enc = s.to_json(data)
print(enc)