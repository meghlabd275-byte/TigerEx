#!/usr/bin/env python3
"""TigerEx REST API Handler"""

from typing import Dict, Any, Callable
import json

class Request:
    def __init__(self, method: str, path: str, body=None, params=None):
        self.method = method
        self.path = path
        self.body = body
        self.params = params or {}

class Response:
    def __init__(self, status: int, data: Any):
        self.status = status
        self.data = data
    
    def json(self):
        return json.dumps(self.status, self.data)

class Router:
    def __init__(self):
        self.routes = {}
    
    def get(self, path: str, handler: Callable):
        self.routes[("GET", path)] = handler
    
    def post(self, path: str, handler: Callable):
        self.routes[("POST", path)] = handler
    
    def dispatch(self, req: Request) -> Response:
        key = (req.method, req.path)
        handler = self.routes.get(key)
        if handler:
            return handler(req)
        return Response(404, {"error": "Not found"})

def get_orders(req):
    return Response(200, {"orders": []})

def create_order(req):
    return Response(201, {"order_id": "123"})

router = Router()
router.post("/orders", create_order)
router.get("/orders", get_orders)

def main():
    resp = router.dispatch(Request("GET", "/orders"))
    print(f"Status: {resp.status}")

if __name__ == "__main__":
    main()