#!/usr/bin/env python3
"""Validate DRAM public data before publishing generated artifacts."""
from __future__ import annotations

import json
from pathlib import Path

from dram_tracker.model import is_finite_number, observation_price


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"VALIDATION FAILED: {message}")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    data_dir = Path("data")
    summary = read_json(data_dir / "summary.json")
    prices = read_json(data_dir / "prices.json")
    status = read_json(data_dir / "status.json")
    health = read_json(data_dir / "automation-health.json")
    require(summary.get("contract") == "quant-research-summary", "summary contract mismatch")
    require(summary.get("projectId") == "dram", "summary projectId mismatch")
    entities = summary.get("primaryEntities")
    require(isinstance(entities, list) and len(entities) >= 2, "summary needs at least two DRAM entities")
    observations = prices.get("observations") if isinstance(prices, dict) else None
    require(isinstance(observations, list) and len(observations) >= 2, "prices needs at least two observations")
    invalid_observations = [obs for obs in observations if not isinstance(obs, dict) or observation_price(obs) is None]
    require(not invalid_observations, f"prices contains {len(invalid_observations)} observations without a finite average price")
    invalid_entities = [
        entity
        for entity in entities
        if not isinstance(entity, dict)
        or not isinstance(entity.get("metrics"), dict)
        or not is_finite_number(entity["metrics"].get("price"))
        or not isinstance(entity["metrics"].get("unit"), str)
        or not entity["metrics"]["unit"].strip()
    ]
    require(not invalid_entities, f"summary contains {len(invalid_entities)} entities without a finite price and unit")
    require(status.get("generatedAt") or status.get("generated_at"), "status needs generated timestamp")
    require(health.get("contract") == "dram-automation-health", "automation health contract mismatch")
    require(health.get("projectId") == "dram", "automation health projectId mismatch")
    require(isinstance(health.get("consecutiveWarningRuns"), int), "automation health warning streak missing")
    require(isinstance(health.get("consecutiveBlockingFailures"), int), "automation health blocking streak missing")
    print(f"Validated DRAM publication data: {len(entities)} entities, {len(observations)} observations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
