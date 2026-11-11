"""
TigerEx compliance reporting: CTR filing, structuring detection and sanctions
screening.

Self-contained and dependency-free. Nothing here pretends to succeed: a filing
requires a real sink and a screening requires a real sanctions list, so a
misconfigured deployment fails closed instead of reporting a phantom filing or
clearing a blocked address.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Iterable, Mapping

CTR_THRESHOLD = 10_000.0
SAR_THRESHOLD = 5_000.0
STRUCTURING_WINDOW = timedelta(hours=24)


class ComplianceError(RuntimeError):
    """Raised when a compliance action cannot be performed for real."""


def _as_timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    raise ComplianceError(f"unsupported timestamp: {value!r}")


@dataclass(frozen=True)
class CTRReport:
    """A Currency Transaction Report ready for filing."""

    report_id: str
    transaction_id: str
    amount: float
    currency: str
    filed_at: datetime


class ComplianceReporter:
    """Files Currency Transaction Reports through a real sink.

    The sink is the channel to the regulator (a filing gateway, an SFTP drop, a
    signed API). With no sink configured, filing fails closed: the venue cannot
    claim a report was filed when nothing received it.
    """

    def __init__(self, sink: Callable[[CTRReport], Awaitable[Mapping[str, Any]]] | None = None):
        self._sink = sink

    async def file_ctr(self, transaction: Mapping[str, Any]) -> dict:
        amount = float(transaction.get("amount", 0) or 0)
        if amount < CTR_THRESHOLD:
            raise ComplianceError(
                f"amount {amount} is below the CTR threshold {CTR_THRESHOLD}"
            )
        if self._sink is None:
            raise ComplianceError("no CTR filing sink configured; report not filed")

        report = CTRReport(
            report_id=str(transaction.get("report_id") or transaction.get("id") or ""),
            transaction_id=str(transaction.get("id") or ""),
            amount=amount,
            currency=str(transaction.get("currency") or ""),
            filed_at=_as_timestamp(transaction.get("timestamp") or datetime.now(timezone.utc)),
        )
        if not report.report_id or not report.transaction_id or not report.currency:
            raise ComplianceError("transaction is missing id, report_id or currency")

        receipt = await self._sink(report)
        return {"status": "filed", "report": report, "receipt": dict(receipt)}

    def check_structuring(self, transactions: Iterable[Mapping[str, Any]]) -> bool:
        """Detect structuring: several sub-threshold payments that together cross
        the CTR threshold inside a rolling 24h window."""
        rows = [
            (_as_timestamp(t.get("timestamp")), float(t.get("amount", 0) or 0))
            for t in transactions
        ]
        rows = [(ts, amt) for ts, amt in rows if 0 < amt < CTR_THRESHOLD]
        rows.sort(key=lambda r: r[0])
        for i, (start, _) in enumerate(rows):
            total = 0.0
            count = 0
            for ts, amt in rows[i:]:
                if ts - start > STRUCTURING_WINDOW:
                    break
                total += amt
                count += 1
            if count >= 3 and total >= CTR_THRESHOLD:
                return True
        return False


class AMLScreener:
    """Screens an address against a sanctions list.

    Screening fails closed: with no list loaded it raises rather than clearing
    the address, so an unconfigured venue cannot silently let a sanctioned
    address through.
    """

    def __init__(self, sanctions: Iterable[str] | None = None):
        self._sanctions = {a.strip().lower() for a in (sanctions or []) if a.strip()}

    async def screen(self, address: str) -> dict:
        if not self._sanctions:
            raise ComplianceError("no sanctions list loaded; cannot screen")
        blocked = address.strip().lower() in self._sanctions
        return {"blocked": blocked, "address": address, "list_size": len(self._sanctions)}


if __name__ == "__main__":
    raise SystemExit("TigerEx compliance module; import it, do not run it.")
