#!/usr/bin/env python3
"""Request Routing"""

from typing import Dict, Callable

class Router:
    def __init__(self):
        self.routes = {}
    
    def add_route(self, path: str, handler: Callable):
        self.routes[path] = handler
    
    def route(self, request: Dict):
        path = request.get("path", "")
        handler = self.routes.get(path)
        
        if not handler:
            return {"status": 404, "body": "Not Found"}
        
        return handler(request)
    
    def list_routes(self):
        return list(self.routes.keys())

def health_handler(req):
    return {"status": 200, "body": "OK"}

router = Router()
router.add_route("/health", health_handler)
print(router.route({"path": "/health"}))