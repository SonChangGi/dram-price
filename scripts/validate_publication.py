#!/usr/bin/env python3
"""Validate DRAM public data before publishing generated artifacts."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path
import re
from urllib.parse import urlparse

from dram_tracker.model import build_public_summary, build_series, is_finite_number, observation_key, observation_price


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"VALIDATION FAILED: {message}")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def validate_publication(data_dir: Path) -> None:
    summary = read_json(data_dir / "summary.json")
    prices = read_json(data_dir / "prices.json")
    status = read_json(data_dir / "status.json")
    series = read_json(data_dir / "series.json")
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
    generated_at = prices.get("generated_at")
    require(isinstance(generated_at, str) and bool(generated_at), "prices needs generated timestamp")
    require(status.get("generated_at") == generated_at, "prices and status timestamps differ")
    require(series.get("generated_at") == generated_at, "prices and series timestamps differ")
    require(summary.get("generatedAt") == generated_at, "prices and summary timestamps differ")
    keys = [observation_key(obs) for obs in observations]
    require(len(set(keys)) == len(keys), "duplicate source/kind/product/cadence/date observations")
    for obs in observations:
        label = f"{obs.get('product_id')} {obs.get('date')}"
        try:
            date.fromisoformat(obs.get("date", ""))
        except (TypeError, ValueError):
            require(False, f"invalid observation date: {label}")
        require(obs.get("effective_date") == obs["date"], f"effective date differs: {label}")
        require(obs.get("currency") == "USD", f"unexpected currency: {label}")
        require(observation_price(obs) > 0, f"price must be positive: {label}")
        if obs.get("source") == "trendforce":
            update = obs.get("source_last_update") or {}
            require(update.get("date") == obs["date"], f"source update date differs: {label}")
            require(obs.get("effective_month") == obs["date"][:7], f"effective month differs: {label}")
            if obs.get("kind") == "contract":
                require(update.get("date_source") == "table_last_update" and update.get("table_kind") == "contract",
                        f"contract requires its own table update provenance: {label}")
            if update.get("date_source") == "table_last_update":
                require(update.get("table_kind") == obs.get("kind"), f"source table kind differs: {label}")
        if obs.get("source") == "memorymarket":
            path = urlparse(str(obs.get("source_url") or "")).path
            route = re.fullmatch(r"/price/(ews|ems)/(\d+)/?", path)
            require(route is not None, f"unsupported MemoryMarket source URL: {label}")
            expected_cadence = "weekly" if route.group(1) == "ews" else "monthly"
            require(obs.get("cadence") == expected_cadence, f"MemoryMarket cadence differs from source URL: {label}")
            require(obs.get("product_id") == f"memorymarket-{route.group(2)}", f"MemoryMarket product differs from source URL: {label}")
    sources = status.get("sources")
    require(isinstance(sources, list) and bool(sources), "source collection status missing")
    require(all(isinstance(source, dict) and source.get("ok") is True and not source.get("errors") and not source.get("warnings")
                and isinstance(source.get("observation_count"), int) and source["observation_count"] > 0
                for source in sources), "source collection failed or returned no observations")
    require(status.get("observation_count") == len(observations), "status observation count differs")
    for dimension in ("source", "kind"):
        expected = dict(Counter(obs.get(dimension, "unknown") for obs in observations))
        require(status.get(f"counts_by_{dimension}") == expected, f"status {dimension} counts differ")
    expected_series = build_series(observations)
    require(series.get("series") == expected_series, "series differs from stored observations")
    expected_summary = build_public_summary(observations, expected_series, status, generated_at)
    require(summary == expected_summary, "summary differs from stored observations")
    require(health.get("contract") == "dram-automation-health", "automation health contract mismatch")
    require(health.get("projectId") == "dram", "automation health projectId mismatch")
    require(isinstance(health.get("consecutiveWarningRuns"), int), "automation health warning streak missing")
    require(isinstance(health.get("consecutiveBlockingFailures"), int), "automation health blocking streak missing")
    print(f"Validated DRAM publication data: {len(entities)} entities, {len(observations)} observations")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args(argv)
    validate_publication(args.data_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
