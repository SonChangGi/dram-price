"""Normalized DRAM tracker data model and merge helpers."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "unknown"


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def observation_key(obs: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        str(obs.get("source", "")),
        str(obs.get("kind", "")),
        str(obs.get("product_id", "")),
        str(obs.get("cadence", "")),
        str(obs.get("date", obs.get("effective_date", ""))),
    )


def merge_observations(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for obs in existing:
        merged[observation_key(obs)] = obs
    for obs in new:
        merged[observation_key(obs)] = obs
    return sorted(merged.values(), key=lambda item: (item.get("date", ""), item.get("source", ""), item.get("kind", ""), item.get("product_name", "")))


def build_series(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for obs in observations:
        product_id = str(obs["product_id"])
        item = seen.setdefault(
            product_id,
            {
                "product_id": product_id,
                "product_name": obs.get("product_name", product_id),
                "source": obs.get("source"),
                "categories": set(),
                "kinds": set(),
                "cadences": set(),
                "representative": is_representative(str(obs.get("product_name", ""))),
            },
        )
        if obs.get("category"):
            item["categories"].add(obs.get("category"))
        item["kinds"].add(obs.get("kind"))
        item["cadences"].add(obs.get("cadence"))
        item["representative"] = item["representative"] or is_representative(str(obs.get("product_name", "")))
    series: list[dict[str, Any]] = []
    for item in seen.values():
        categories = sorted(c for c in item["categories"] if c)
        item["categories"] = categories
        item["category"] = categories[0] if len(categories) == 1 else ("mixed" if categories else "uncategorized")
        item["kinds"] = sorted(k for k in item["kinds"] if k)
        item["cadences"] = sorted(c for c in item["cadences"] if c)
        series.append(item)
    return sorted(series, key=lambda row: (not row["representative"], row["source"] or "", row["product_name"]))


def is_representative(product_name: str) -> bool:
    name = product_name.lower()
    patterns = [
        "ddr5 16gb",
        "ddr5 16gb",
        "ddr5 16gb (2gx8)",
        "ddr4 16gb 3200",
        "ddr4 16gb (2gx8) 3200",
        "ddr4 8gb 3200",
        "ddr4 8gb (1gx8) 3200",
        "ddr4 16gb so-dimm",
        "ddr5 8gb so-dimm",
    ]
    return any(pattern in name for pattern in patterns)


def summarize_status(observations: list[dict[str, Any]], source_status: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    counts_by_source = Counter(obs.get("source", "unknown") for obs in observations)
    counts_by_kind = Counter(obs.get("kind", "unknown") for obs in observations)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "observation_count": len(observations),
        "counts_by_source": dict(sorted(counts_by_source.items())),
        "counts_by_kind": dict(sorted(counts_by_kind.items())),
        "sources": source_status,
        "caveats": [
            "TrendForce/DRAMeXchange public pages expose current tables but not free historical data.",
            "MemoryMarket publicly discloses six-month weekly history; respect source terms and attribution.",
            "Contract prices are monthly/update-date observations; collected_at is not the effective price date.",
        ],
    }
