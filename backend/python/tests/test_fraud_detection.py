"""Tests for the fraud-screening engine.

The properties that matter for compliance: a sanctioned jurisdiction and a
new-account burst raise the score, an alert is only created for high/critical
risk, the account-age check uses the account's real creation time, and a
negative amount is rejected rather than scored.
"""

from datetime import datetime, timedelta

import pytest

from fraud_detection import (
    AlertStatus,
    FraudDetectionEngine,
    RiskLevel,
    Transaction,
)


def _tx(tx_id, user_id, amount, ts, country="US", ip="10.0.0.1", fp="fp1", kind="deposit"):
    return Transaction(tx_id, user_id, amount, "USDT", kind, ts, ip, fp, country)


def test_configuration_is_validated():
    with pytest.raises(ValueError):
        FraudDetectionEngine(large_amount_threshold=1000.0, elevated_amount_threshold=1000.0)
    with pytest.raises(ValueError):
        FraudDetectionEngine(new_account_days=-1)


def test_negative_amount_is_rejected():
    engine = FraudDetectionEngine()
    with pytest.raises(ValueError):
        engine.screen_transaction(_tx("t", "u", -5.0, datetime.now()))


def test_large_amount_and_sanctioned_jurisdiction_raise_the_score():
    engine = FraudDetectionEngine()
    now = datetime.now()
    engine.register_user("u", now - timedelta(days=365))

    _, alert = engine.screen_transaction(_tx("t1", "u", 20_000.0, now))
    # A large amount alone (30) is below the 40 medium threshold.
    assert alert is None

    level, alert = engine.screen_transaction(_tx("t2", "u", 100.0, now, country="KP"))
    assert level in (RiskLevel.HIGH, RiskLevel.CRITICAL)
    assert alert is not None
    assert alert.transaction_id == "t2"


def test_new_account_is_scored_higher_than_aged_account():
    now = datetime.now()
    engine = FraudDetectionEngine()
    engine.register_user("new", now - timedelta(days=1))
    engine.register_user("old", now - timedelta(days=900))

    fresh = _tx("a", "new", 100.0, now)
    aged = _tx("b", "old", 100.0, now)
    assert engine.calculate_risk_score(fresh) > engine.calculate_risk_score(aged)


def test_alert_lifecycle_transitions():
    engine = FraudDetectionEngine()
    now = datetime.now()
    engine.register_user("u", now - timedelta(days=365))
    _, alert = engine.screen_transaction(_tx("t", "u", 100.0, now, country="IR"))
    assert alert is not None

    assert engine.confirm_alert(alert.id) is True
    assert alert.status == AlertStatus.CONFIRMED
    assert engine.get_alerts(AlertStatus.CONFIRMED)[0].id == alert.id
    # An unknown alert id is reported as not found, not silently accepted.
    assert engine.update_alert_status("ALERT_nope", AlertStatus.RESOLVED) is False


def test_learn_pattern_requires_matching_user():
    engine = FraudDetectionEngine()
    now = datetime.now()
    with pytest.raises(ValueError):
        engine.learn_user_pattern("other", _tx("t", "u", 10.0, now))


def test_stats_precision_uses_resolved_alerts():
    engine = FraudDetectionEngine()
    now = datetime.now()
    engine.register_user("u", now - timedelta(days=365))
    engine.screen_transaction(_tx("t1", "u", 100.0, now, country="KP"))
    engine.screen_transaction(_tx("t2", "u", 100.0, now, country="CU"))

    stats = engine.get_stats()
    assert stats["total_transactions"] == 2
    assert stats["total_alerts"] >= 1
    # Nothing confirmed yet: precision is zero, not a fabricated 1.0.
    assert stats["precision"] == 0.0
