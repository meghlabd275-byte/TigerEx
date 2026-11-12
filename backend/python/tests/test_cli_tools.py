"""Tests for the CLI entry points of the analytics tools.

These tools are meant to be run by an operator against real JSON input, so the
contract that matters is: valid input produces a result and exit code 0, and
malformed or incomplete input fails with a non-zero exit code instead of
emitting a fabricated portfolio.
"""

import json

import pytest

import analytics
import portfolio


def test_analytics_cli_computes_portfolio_value(tmp_path, capsys):
    holdings = tmp_path / "holdings.json"
    prices = tmp_path / "prices.json"
    holdings.write_text(json.dumps({"BTC": 2.0, "ETH": 5.0}))
    prices.write_text(json.dumps({"BTC": 50000.0, "ETH": 3000.0}))

    assert analytics.main([str(holdings), str(prices)]) == 0
    out = capsys.readouterr().out
    assert "Portfolio Value" in out


def test_analytics_cli_wrong_arity_is_usage_error(capsys):
    assert analytics.main(["only-one.json"]) == 1
    assert "usage" in capsys.readouterr().err.lower()


def test_analytics_cli_unpriced_holding_fails(tmp_path, capsys):
    holdings = tmp_path / "holdings.json"
    prices = tmp_path / "prices.json"
    holdings.write_text(json.dumps({"BTC": 1.0, "DOGE": 1.0}))
    prices.write_text(json.dumps({"BTC": 50000.0}))

    assert analytics.main([str(holdings), str(prices)]) == 1
    assert "cannot compute" in capsys.readouterr().err.lower()


def test_analytics_cli_missing_file_fails(tmp_path):
    with pytest.raises((OSError, ValueError)):
        analytics._load_json(str(tmp_path / "does-not-exist.json"))


def test_portfolio_cli_usage_error(capsys):
    assert portfolio.main([]) == 1
