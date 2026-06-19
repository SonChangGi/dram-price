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


def build_public_summary(
    observations: list[dict[str, Any]],
    series: list[dict[str, Any]],
    status: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    """Return a compact cross-project summary for the quant-dashboard hub."""

    latest_by_product: dict[str, dict[str, Any]] = {}
    for obs in observations:
        key = str(obs.get("product_id") or obs.get("product_name") or "unknown")
        current = latest_by_product.get(key)
        if current is None or str(obs.get("date") or "") >= str(current.get("date") or ""):
            latest_by_product[key] = obs
    representative_ids = {str(item.get("product_id")) for item in series if item.get("representative")}
    latest_rows = sorted(
        latest_by_product.values(),
        key=lambda item: (
            str(item.get("product_id")) not in representative_ids,
            str(item.get("date") or ""),
            str(item.get("product_name") or ""),
        ),
        reverse=False,
    )[:12]
    latest_date = max((str(obs.get("date")) for obs in observations if obs.get("date")), default=None)
    source_states = status.get("sources") if isinstance(status.get("sources"), list) else []
    failed_sources = [str(source.get("source")) for source in source_states if isinstance(source, dict) and not source.get("ok", True)]
    state = "degraded" if failed_sources else ("ok" if observations else "degraded")
    return {
        "schemaVersion": 1,
        "contract": "quant-research-summary",
        "projectId": "dram",
        "projectName": "D램(DRAM) 가격 랩",
        "generatedAt": generated_at,
        "dataAsOf": latest_date,
        "timezone": "UTC",
        "detailUrl": "https://sonchanggi.github.io/dram-price/",
        "detailDataUrl": "https://sonchanggi.github.io/dram-price/data/prices.json",
        "status": {
            "state": state,
            "label": "source degraded" if failed_sources else f"{len(observations)}개 가격 관측치",
            "cadence": "TrendForce current tables + MemoryMarket weekly public history",
            "expectedFreshnessDays": 14,
            "degradedReasons": failed_sources,
        },
        "coverage": {
            "observationCount": len(observations),
            "seriesCount": len(series),
            "countsBySource": status.get("counts_by_source", {}),
            "countsByKind": status.get("counts_by_kind", {}),
        },
        "highlights": [
            {"label": "관측치", "value": len(observations), "description": "source/kind/product/date 병합 후 저장"},
            {"label": "제품군", "value": len(series), "description": "대표 DRAM 시리즈 포함"},
            {"label": "최근 관측일", "value": latest_date, "description": "관측별 effective date 우선"},
        ],
        "primaryEntities": [
            {
                "symbol": "DRAM",
                "name": row.get("product_name"),
                "label": f"{row.get('product_name') or 'DRAM'} · {row.get('kind') or 'kind N/A'}",
                "sector": "Semiconductors",
                "sectorLabel": "반도체",
                "themes": ["DRAM", "Memory", "Semiconductors", str(row.get("category") or "")],
                "metrics": {
                    "price": row.get("price"),
                    "unit": row.get("unit"),
                    "date": row.get("date"),
                    "source": row.get("source"),
                    "kind": row.get("kind"),
                    "cadence": row.get("cadence"),
                },
                "signals": ["메모리 가격 방향은 반도체 밸류체인 점검 출발점입니다."],
                "warnings": ["공개 원천별 업데이트 주기와 품목 커버리지가 다릅니다."],
            }
            for row in latest_rows
        ],
        "limitations": list(status.get("caveats") or []),
        "sources": [
            {"label": "TrendForce / DRAMeXchange", "url": "https://www.dramexchange.com/"},
            {"label": "MemoryMarket", "url": "https://www.memorymarket.com/"},
        ],
        "automation": {
            "workflowUrl": "https://github.com/SonChangGi/dram-price/actions/workflows/update-data.yml",
            "manualUpdateLabel": "GitHub Actions update-data 수동 실행",
            "tokenPolicy": "Static page keeps no source credentials.",
        },
        "payload": {
            "summaryBytes": None,
            "detailBytes": None,
        },
    }
