"""Command-line collector for the DRAM price tracker."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

from dram_tracker.http import fetch_text
from dram_tracker.model import (
    SCHEMA_VERSION,
    build_public_summary,
    build_series,
    merge_observations,
    read_json,
    summarize_status,
    utc_now_iso,
    write_json,
)
from dram_tracker.sources import memorymarket, trendforce


def _load_fixture(fixture_dir: Path, *names: str) -> str:
    for name in names:
        path = fixture_dir / name
        if path.exists():
            return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"fixture missing: one of {names}")


def collect_trendforce(*, fixture_dir: Path | None, collected_at: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    status = {"source": "trendforce", "ok": True, "urls": [trendforce.SPOT_URL, trendforce.CONTRACT_URL], "warnings": [], "errors": []}
    try:
        if fixture_dir:
            spot_html = _load_fixture(fixture_dir, "trendforce_spot.html")
            contract_html = _load_fixture(fixture_dir, "trendforce_contract.html", "trendforce_spot.html")
        else:
            spot_html = fetch_text(trendforce.SPOT_URL)
            contract_html = fetch_text(trendforce.CONTRACT_URL)
        observations.extend(trendforce.parse_price_page(spot_html, kind="spot", url=trendforce.SPOT_URL, collected_at=collected_at))
        observations.extend(trendforce.parse_price_page(contract_html, kind="contract", url=trendforce.CONTRACT_URL, collected_at=collected_at))
    except Exception as exc:  # noqa: BLE001 - source failures should be recorded, not fatal to other sources.
        status["ok"] = False
        status["errors"].append(str(exc))
    status["observation_count"] = len(observations)
    return observations, status


def collect_memorymarket(*, fixture_dir: Path | None, collected_at: str, limit_products: int | None, delay: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    status = {"source": "memorymarket", "ok": True, "urls": [], "warnings": [], "errors": []}
    products: list[dict[str, str]] = []
    try:
        if fixture_dir:
            for category in memorymarket.CATEGORIES:
                path = fixture_dir / f"memorymarket_category_{category}.html"
                if path.exists():
                    products.extend(memorymarket.discover_products(path.read_text(encoding="utf-8"), category=category))
        else:
            for category in memorymarket.CATEGORIES:
                url = f"{memorymarket.BASE_URL}/price/{category}"
                status["urls"].append(url)
                products.extend(memorymarket.discover_products(fetch_text(url), category=category))
                time.sleep(delay)
        # Deduplicate by URL.
        deduped = {product["url"]: product for product in products}
        products = sorted(deduped.values(), key=lambda product: product["product_name"])
        if limit_products is not None:
            products = products[: max(0, limit_products)]
        for product in products:
            url = product["url"]
            status["urls"].append(url)
            try:
                if fixture_dir:
                    numeric = product["product_id"].split("-")[-1]
                    html = _load_fixture(fixture_dir, f"memorymarket_product_{numeric}.html", "memorymarket_product.html")
                else:
                    html = fetch_text(url)
                    time.sleep(delay)
                observations.extend(
                    memorymarket.parse_product_history(
                        html,
                        url=url,
                        product_name=product["product_name"],
                        product_id=product["product_id"],
                        category=product.get("category"),
                        collected_at=collected_at,
                    )
                )
            except Exception as exc:  # noqa: BLE001
                status["warnings"].append(f"{product['product_name']}: {exc}")
    except Exception as exc:  # noqa: BLE001
        status["ok"] = False
        status["errors"].append(str(exc))
    status["observation_count"] = len(observations)
    return observations, status


def run(args: argparse.Namespace) -> int:
    output = Path(args.output)
    fixture_dir = Path(args.fixture_dir) if args.fixture_dir else None
    collected_at = utc_now_iso()
    source_status: list[dict[str, Any]] = []
    new_observations: list[dict[str, Any]] = []

    if args.include_trendforce:
        obs, status = collect_trendforce(fixture_dir=fixture_dir, collected_at=collected_at)
        new_observations.extend(obs)
        source_status.append(status)
    if args.include_memorymarket:
        obs, status = collect_memorymarket(fixture_dir=fixture_dir, collected_at=collected_at, limit_products=args.limit_products, delay=args.delay)
        new_observations.extend(obs)
        source_status.append(status)

    prices_path = output / "prices.json"
    existing_payload = read_json(prices_path, {"observations": []})
    existing_observations = existing_payload.get("observations", []) if isinstance(existing_payload, dict) else []
    observations = merge_observations(existing_observations, new_observations)

    series = build_series(observations)
    status = summarize_status(observations, source_status, collected_at)
    write_json(prices_path, {"schema_version": SCHEMA_VERSION, "generated_at": collected_at, "observations": observations})
    write_json(output / "series.json", {"schema_version": SCHEMA_VERSION, "generated_at": collected_at, "series": series})
    write_json(output / "status.json", status)
    summary = build_public_summary(observations, series, status, collected_at)
    write_json(output / "summary.json", summary)

    print(f"collected {len(new_observations)} new observations; stored {len(observations)} total observations in {output}")
    failed = [source for source in source_status if not source.get("ok")]
    return 2 if failed and not observations else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect public DRAM price data into normalized JSON files.")
    parser.add_argument("--output", default="data", help="Output directory for prices.json, series.json, and status.json")
    parser.add_argument("--fixture-dir", help="Use local fixture HTML instead of live network sources")
    parser.add_argument("--limit-products", type=int, default=None, help="Limit MemoryMarket product pages for smoke runs")
    parser.add_argument("--delay", type=float, default=0.5, help="Polite delay between MemoryMarket requests")
    parser.add_argument("--include-trendforce", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--include-memorymarket", action=argparse.BooleanOptionalAction, default=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
