#!/usr/bin/env python3
"""Import Service"""

import csv

class Importer:
    def from_csv(self, path):
        with open(path, 'r') as f:
            return list(csv.DictReader(f))
    
    def validate(self, data, schema):
        errors = []
        for row in data:
            for k, t in schema.items():
                if k not in row:
                    errors.append(f"Missing {k}")
        return errors

imp = Importer()
data = imp.from_csv("data.csv")
print(f"Rows: {len(data)}")