#!/usr/bin/env python3
"""Search Engine"""

from collections import defaultdict

class SearchEngine:
    def __init__(self):
        self.index = defaultdict(list)
        self.documents = {}
    
    def index_document(self, doc_id, text):
        self.documents[doc_id] = text
        terms = text.lower().split()
        for term in terms:
            self.index[term].append(doc_id)
    
    def search(self, query):
        terms = query.lower().split()
        if not terms:
            return []
        
        results = set(self.index[terms[0]])
        for term in terms[1:]:
            results &= set(self.index[term])
        
        return [(doc_id, self.documents[doc_id]) for doc_id in results]
    
    def suggest(self, prefix):
        return [term for term in self.index if term.startswith(prefix)]

se = SearchEngine()
se.index_document("1", "Bitcoin price chart")
se.index_document("2", "Ethereum price chart")
print(se.search("bitcoin"))