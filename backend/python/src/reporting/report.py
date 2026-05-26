#!/usr/bin/env python3
"""Reporting Module"""

from datetime import datetime
import json

class Report:
    def __init__(self, title):
        self.title = title
        self.created = datetime.now().isoformat()
        self.sections = {}
    
    def add_metric(self, name, value):
        self.sections[name] = value
    
    def to_dict(self):
        return {
            "title": self.title,
            "created": self.created,
            "metrics": self.sections
        }
    
    def to_json(self):
        return json.dumps(self.to_dict(), indent=2)
    
    def to_csv_row(self):
        headers = ",".join(self.sections.keys())
        values = ",".join(str(v) for v in self.sections.values())
        return f"{headers}\n{values}"

r = Report("Daily Report")
r.add_metric("volume", 1000)
r.add_metric("trades", 500)
print(r.to_json())