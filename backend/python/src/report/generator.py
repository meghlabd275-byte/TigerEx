#!/usr/bin/env python3
"""Report Generator"""

from datetime import datetime
from decimal import Decimal

class Report:
    def __init__(self, title):
        self.title = title
        self.sections = []
        self.generated = datetime.now()
    
    def add_section(self, name, data):
        self.sections.append({"name": name, "data": data})
    
    def to_html(self):
        html = f"<h1>{self.title}</h1>\n"
        for s in self.sections:
            html += f"<h2>{s['name']}</h2>\n"
            html += f"<pre>{s['data']}</pre>\n"
        return html

r = Report("Daily Report")
r.add_section("Summary", "All systems operational")
print(r.to_html())