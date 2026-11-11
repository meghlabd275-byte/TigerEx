from datetime import datetime, timedelta, timezone

import pytest

from compliance import (
    AMLScreener,
    ComplianceError,
    ComplianceReporter,
    CTR_THRESHOLD,
)

UTC = timezone.utc


def test_file_ctr_without_sink_fails_closed():
    reporter = ComplianceReporter()
    with pytest.raises(ComplianceError):
        import asyncio

        asyncio.run(
            reporter.file_ctr({"id": "t1", "amount": 15_000, "currency": "USD"})
        )


def test_file_ctr_below_threshold_is_rejected():
    async def sink(report):
        return {"ok": True}

    reporter = ComplianceReporter(sink=sink)
    import asyncio

    with pytest.raises(ComplianceError):
        asyncio.run(
            reporter.file_ctr({"id": "t2", "amount": 500, "currency": "USD"})
        )


def test_file_ctr_reaches_the_real_sink():
    seen = {}

    async def sink(report):
        seen["report"] = report
        return {"ack": "1"}

    reporter = ComplianceReporter(sink=sink)
    import asyncio

    result = asyncio.run(
        reporter.file_ctr({"id": "t3", "amount": CTR_THRESHOLD, "currency": "USD"})
    )
    assert result["status"] == "filed"
    assert result["receipt"] == {"ack": "1"}
    assert seen["report"].transaction_id == "t3"


def test_structuring_detected_within_window():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    txs = [
        {"amount": 4_000, "timestamp": now + timedelta(hours=i)}
        for i in range(3)
    ]
    assert ComplianceReporter().check_structuring(txs) is True


def test_structuring_not_detected_across_window():
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    txs = [
        {"amount": 4_000, "timestamp": now + timedelta(days=i)}
        for i in range(3)
    ]
    assert ComplianceReporter().check_structuring(txs) is False


def test_screen_without_list_fails_closed():
    import asyncio

    with pytest.raises(ComplianceError):
        asyncio.run(AMLScreener().screen("0xabc"))


def test_screen_blocks_listed_address():
    import asyncio

    screener = AMLScreener(sanctions=["0xBAD"])
    assert asyncio.run(screener.screen("0xbad"))["blocked"] is True
    assert asyncio.run(screener.screen("0xgood"))["blocked"] is False
