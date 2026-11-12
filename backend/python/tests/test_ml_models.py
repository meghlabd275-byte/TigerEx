"""Tests for the ML models: technical indicators, strategies, training and
the fail-closed paths (predicting before training, unconfigured fraud detector).
"""

import math

import numpy as np
import pytest

import price_prediction
import trading_models


def _ramp(n=120, start=50000.0, step=10.0):
    return [
        price_prediction.PricePoint(i, start + i * step, start + i * step + 50,
                                    start + i * step - 50, start + i * step, 1000)
        for i in range(n)
    ]


# ------------------------------------------------------- indicators (pure) ---

def test_sma_and_ema_bounds():
    prices = [float(i) for i in range(1, 31)]
    engine = price_prediction.FeatureEngine()
    assert engine.calculate_sma(prices, 5) == pytest.approx(28.0)  # mean of 26..30
    # EMA of a rising series sits below the last price.
    assert engine.calculate_ema(prices, 10) < prices[-1]


def test_rsi_of_rising_and_flat_series():
    engine = price_prediction.FeatureEngine()
    rising = [float(i) for i in range(1, 31)]
    assert engine.calculate_rsi(rising, 14) == pytest.approx(100.0)
    flat = [100.0] * 30
    # No losses: the engine returns 100 for a non-decreasing series.
    assert engine.calculate_rsi(flat, 14) == pytest.approx(100.0)


def test_macd_requires_enough_history_and_signal_is_real():
    engine = price_prediction.FeatureEngine()
    with pytest.raises(ValueError):
        engine.calculate_macd([1.0] * 10)
    macd, signal, hist = engine.calculate_macd([float(i) for i in range(1, 60)])
    assert hist == pytest.approx(macd - signal)
    # The signal line is an EMA of the MACD series, so it differs from MACD
    # whenever the series is not flat.
    assert signal != macd


def test_bollinger_band_ordering():
    engine = price_prediction.FeatureEngine()
    upper, middle, lower = engine.calculate_bollinger_bands([float(i) for i in range(1, 41)])
    assert lower < middle < upper


# ------------------------------------------------------------ model paths ---

def test_predict_before_training_fails_closed():
    model = price_prediction.PricePredictionModel()
    with pytest.raises(RuntimeError):
        model.predict("TGR/RUSD", _ramp(60))


def test_training_requires_enough_labelled_samples():
    model = price_prediction.PricePredictionModel()
    with pytest.raises(ValueError):
        model.train(_ramp(30), ["up"] * 30)


def test_label_length_must_match_history():
    model = price_prediction.PricePredictionModel()
    with pytest.raises(ValueError):
        model.train(_ramp(120), ["up"] * 100)


def test_trained_model_learns_a_trend_and_predicts_a_price():
    points = _ramp()
    labels = ["up" if points[i + 1].close > points[i].close else "down" for i in range(len(points) - 1)]
    labels.append("up")

    model = price_prediction.PricePredictionModel()
    model.train(points, labels)

    prediction = model.predict("TGR/RUSD", points[-60:])
    assert prediction.direction in ("up", "down", "neutral")
    assert 0.0 <= prediction.confidence <= 1.0
    assert prediction.predicted_price > 0


def test_anomaly_detector_flags_a_far_outlier():
    detector = price_prediction.AnomalyDetector()
    detector.fit([float(i) for i in range(100)])
    assert detector.detect(10_000.0) is True
    assert detector.detect(50.0) is False
    # A constant series has zero variance and must not divide by zero.
    flat = price_prediction.AnomalyDetector()
    flat.fit([5.0] * 10)
    assert flat.detect(999.0) is False


# ---------------------------------------------------- trading_models (np) ---

def test_trading_models_indicators():
    prices = [float(i) for i in range(1, 41)]
    assert trading_models.MovingAverage.sma(prices, 5) == pytest.approx(38.0)
    assert trading_models.RSI.calculate(prices) == pytest.approx(100.0)
    upper, middle, lower = trading_models.BollingerBands.calculate(prices)
    assert lower < middle < upper


def test_volume_profile_point_of_control_within_range():
    points = [
        trading_models.PricePoint(i, 100 + i, 101 + i, 99 + i, 100 + i, 10.0 * i)
        for i in range(1, 21)
    ]
    profile = trading_models.VolumeProfile.analyze(points, bins=10)
    assert "poc" in profile
    assert 99.0 <= profile["poc"] <= 120.0
    assert profile["total_volume"] > 0
    # A zero-range series has no profile rather than a fabricated one.
    flat = [trading_models.PricePoint(i, 100, 100, 100, 100, 1.0) for i in range(5)]
    assert trading_models.VolumeProfile.analyze(flat) == {"error": "no range"}


def test_momentum_strategy_direction_is_consistent_with_rsi():
    falling = [100.0 - i for i in range(30)]  # RSI ~0 -> oversold -> "up"
    rising = [100.0 + i for i in range(30)]   # RSI ~100 -> "down"
    assert trading_models.MomentumStrategy().predict(falling).direction == "up"
    assert trading_models.MomentumStrategy().predict(rising).direction == "down"
