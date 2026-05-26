#!/usr/bin/env python3
"""Distributed Tracing"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
import time
import uuid

@dataclass
class Span:
    trace_id: str
    span_id: str
    service: str
    operation: str
    start_time: float
    end_time: Optional[float] = None
    tags: Dict[str, str] = field(default_factory=dict)
    logs: List[Dict] = field(default_factory=list)

class Tracer:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.spans: Dict[str, Span] = {}
    
    def start_span(self, operation: str, trace_id: str = None) -> str:
        trace_id = trace_id or str(uuid.uuid4())[:16]
        span_id = str(uuid.uuid4())[:8]
        
        span = Span(
            trace_id=trace_id,
            span_id=span_id,
            service=self.service_name,
            operation=operation,
            start_time=time.time()
        )
        self.spans[span_id] = span
        return span_id
    
    def end_span(self, span_id: str):
        if span_id in self.spans:
            self.spans[span_id].end_time = time.time()
    
    def add_tag(self, span_id: str, key: str, value: str):
        if span_id in self.spans:
            self.spans[span_id].tags[key] = value
    
    def add_log(self, span_id: str, message: str, **kwargs):
        if span_id in self.spans:
            self.spans[span_id].logs.append({
                "time": time.time(),
                "message": message,
                **kwargs
            })
    
    def get_duration(self, span_id: str) -> float:
        span = self.spans.get(span_id)
        if span and span.end_time:
            return span.end_time - span.start_time
        return 0.0
    
    def get_metrics(self) -> Dict[str, float]:
        durations = {}
        for span in self.spans.values():
            if span.end_time:
                d = span.end_time - span.start_time
                durations[span.operation] = durations.get(span.operation, 0) + d
        return durations

# Usage
tracer = Tracer("order-service")
span_id = tracer.start_span("create_order")
tracer.add_tag(span_id, "user_id", "123")
# ... do work ...
tracer.end_span(span_id)
print(f"Duration: {tracer.get_duration(span_id):.3f}s")