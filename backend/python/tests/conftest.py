"""Shared test bootstrap for the TigerEx Python analytics/ML layer.

There is no installed package: the modules live in `src/analytics` and `src/ml`
and import each other by bare module name. This puts both directories on
`sys.path` so a test can `import backtest` or `import price_prediction`.
"""

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for _sub in ("src/analytics", "src/ml"):
    _path = os.path.join(_ROOT, _sub)
    if _path not in sys.path:
        sys.path.insert(0, _path)
