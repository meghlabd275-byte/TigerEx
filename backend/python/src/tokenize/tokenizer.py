#!/usr/bin/env python3
"""Tokenizer"""

import re

class Tokenizer:
    def __init__(self):
        self.tokens = []
    
    def tokenize(self, code):
        patterns = [
            ('STRING', r'"[^"]*"'),
            ('NUMBER', r'\d+'),
            ('IDENT', r'[a-zA-Z_]\w*'),
            ('OP', r'[+\-*/=]'),
        ]
        pos = 0
        while pos < len(code):
            matched = False
            for name, pat in patterns:
                m = re.match(pat, code[pos:])
                if m:
                    self.tokens.append((name, m.group()))
                    pos += m.end()
                    matched = True
                    break
            if not matched:
                pos += 1
        return self.tokens

t = Tokenizer()
print(t.tokenize("x = 1"))