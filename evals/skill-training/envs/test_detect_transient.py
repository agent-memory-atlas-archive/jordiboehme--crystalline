"""A rejected rate-limit event is transient unless the session ran on allowed overage.

    uv run --with pytest pytest envs/test_detect_transient.py
"""
from __future__ import annotations

from envs.common import detect_transient


def _event(**info):
    return [{"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "rateLimitType": "seven_day", **info}}]


def test_rejected_with_allowed_overage_is_not_transient():
    assert detect_transient(_event(isUsingOverage=True, overageStatus="allowed")) == ""


def test_rejected_without_overage_is_transient():
    assert detect_transient(_event()) == "rate limited (seven_day)"


def test_rejected_with_overage_not_allowed_is_transient():
    assert detect_transient(_event(isUsingOverage=True, overageStatus="rejected")) == "rate limited (seven_day)"
    assert detect_transient(_event(isUsingOverage=False, overageStatus="allowed")) == "rate limited (seven_day)"
