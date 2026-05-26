#!/usr/bin/env python3
"""Export Service - CSV/Excel/JSON"""

import csv
import json

class Exporter:
    def to_csv(self, data, path):
        with open(path, 'w') as f:
            w = csv.DictWriter(f, fieldnames=data[0].keys() if data else [])
            w.writeheader()
            w.writerows(data)
    
    def to_json(self, data, path):
        with open(path, 'w') as f:
            json.dump(data, f)

exp = Exporter()
exp.to_csv([{"a": 1}], "export.csv")