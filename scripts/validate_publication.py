#!/usr/bin/env python3
"""Validate DRAM public data before publishing generated artifacts."""
from __future__ import annotations

import json
from pathlib import Path


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
    require(summary.get("contract") == "quant-research-summary", "summary contract mismatch")
    require(summary.get("projectId") == "dram", "summary projectId mismatch")
    entities = summary.get("primaryEntities")
    require(isinstance(entities, list) and len(entities) >= 2, "summary needs at least two DRAM entities")
    observations = prices.get("observations") if isinstance(prices, dict) else None
    require(isinstance(observations, list) and len(observations) >= 2, "prices needs at least two observations")
    require(status.get("generatedAt") or status.get("generated_at"), "status needs generated timestamp")
    print(f"Validated DRAM publication data: {len(entities)} entities, {len(observations)} observations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
