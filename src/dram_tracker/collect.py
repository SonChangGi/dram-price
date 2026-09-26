"""Command-line collector for the DRAM price tracker."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

from dram_tracker.http import fetch_text
from dram_tracker.history import archive_spot, load_spot_archive, daily_products, record_recovery
from dram_tracker.freshness import REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS
from datetime import date
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
    # Preserve a valid spot table even if the independent contract request fails.
    for kind, url in (("spot", trendforce.SPOT_URL), ("contract", trendforce.CONTRACT_URL)):
        try:
            if fixture_dir:
                names = ("trendforce_spot.html",) if kind == "spot" else ("trendforce_contract.html", "trendforce_spot.html")
                html = _load_fixture(fixture_dir, *names)
            else:
                html = fetch_text(url)
            observations.extend(trendforce.parse_price_page(html, kind=kind, url=url, collected_at=collected_at))
        except Exception as exc:  # noqa: BLE001 - independent source tables keep their valid observations.
            status["ok"] = False
            status["errors"].append(f"{kind}: {exc}")
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
                    category_products = memorymarket.discover_products(path.read_text(encoding="utf-8"), category=category)
                    if not category_products:
                        raise ValueError(f"MemoryMarket {category} category returned no products")
                    products.extend(category_products)
        else:
            for category in memorymarket.CATEGORIES:
                url = f"{memorymarket.BASE_URL}/price/{category}"
                status["urls"].append(url)
                category_products = memorymarket.discover_products(fetch_text(url), category=category)
                if not category_products:
                    raise ValueError(f"MemoryMarket category returned no products: {url}")
                products.extend(category_products)
                time.sleep(delay)
        # Deduplicate by URL.
        deduped = {product["url"]: product for product in products}
        products = sorted(deduped.values(), key=lambda product: product["product_name"])
        if limit_products is not None:
            products = products[: max(0, limit_products)]
        if not products:
            raise ValueError("MemoryMarket product discovery returned no products")
        def add_product_observations(product: dict[str, str], html: str) -> None:
            observations.extend(memorymarket.parse_product_history(
                html, url=product["url"], product_name=product["product_name"],
                product_id=product["product_id"], category=product.get("category"),
                collected_at=collected_at,
            ))

        deferred_products: list[dict[str, str]] = []
        for product in products:
            url = product["url"]
            status["urls"].append(url)
            try:
                if fixture_dir:
                    numeric = product["product_id"].split("-")[-1]
                    html = _load_fixture(fixture_dir, f"memorymarket_product_{numeric}.html", "memorymarket_product.html")
                else:
                    try:
                        html = fetch_text(url)
                    except (OSError, RuntimeError) as exc:
                        # fetch_text exhausts its transport retries before raising.
                        # Parse/identity failures below never enter this retry queue.
                        deferred_products.append(product)
                        print(f"memorymarket: deferring one fetch retry for {url}: {exc}", file=sys.stderr)
                        continue
                    time.sleep(delay)
                add_product_observations(product, html)
            except Exception as exc:  # noqa: BLE001
                status["warnings"].append(f"{product['product_name']}: {exc}")
        # Retry only failed fetches after visiting every other product. Successful
        # pages remain in this attempt; no stored price substitutes for a failure.
        for product in deferred_products:
            try:
                html = fetch_text(product["url"], timeout=60, retries=0)
                time.sleep(delay)
                add_product_observations(product, html)
            except Exception as exc:  # noqa: BLE001
                status["warnings"].append(f"{product['product_name']}: {exc} (after deferred fetch retry)")
    except Exception as exc:  # noqa: BLE001
        status["ok"] = False
        status["errors"].append(str(exc))
    status["observation_count"] = len(observations)
    if status["warnings"] or not observations:
        status["ok"] = False
    return observations, status


def validate_rebuild_metadata(existing_payload: dict[str, Any], previous_status: Any) -> tuple[str, list[dict[str, Any]]]:
    """Validate stored provenance before rebuild-only replaces any output."""

    if not isinstance(previous_status, dict):
        raise ValueError("rebuild-only requires stored status metadata")
    generated_at = previous_status.get("generated_at")
    if not isinstance(generated_at, str) or not generated_at.strip():
        raise ValueError("rebuild-only requires status generated_at")
    prices_generated_at = existing_payload.get("generated_at")
    if prices_generated_at is not None:
        if not isinstance(prices_generated_at, str) or not prices_generated_at.strip():
            raise ValueError("rebuild-only requires a valid prices generated_at")
        if prices_generated_at != generated_at:
            raise ValueError("rebuild-only requires matching prices and status generated_at")

    sources = previous_status.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("rebuild-only requires non-empty status sources")
    source_names: set[str] = set()
    for index, source in enumerate(sources):
        label = f"rebuild-only status source #{index + 1}"
        if not isinstance(source, dict):
            raise ValueError(f"{label} must be an object")
        source_name = source.get("source")
        if not isinstance(source_name, str) or not source_name.strip():
            raise ValueError(f"{label} requires a source name")
        if source_name in source_names:
            raise ValueError(f"{label} duplicates source {source_name}")
        source_names.add(source_name)
        if not isinstance(source.get("ok"), bool):
            raise ValueError(f"{label} requires boolean ok")
        observation_count = source.get("observation_count")
        if isinstance(observation_count, bool) or not isinstance(observation_count, int) or observation_count < 0:
            raise ValueError(f"{label} requires non-negative integer observation_count")
        for field in ("urls", "warnings", "errors"):
            values = source.get(field)
            if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                raise ValueError(f"{label} requires a string list for {field}")
    return generated_at, sources


def validate_source_coverage(existing: list[dict], current: list[dict], sources: list[dict]) -> None:
    """A vanished known product is a collection failure, not a fresh old price."""
    for source in sources:
        expected = {(r.get("kind"), r.get("product_id")) for r in existing if r.get("source") == source["source"]}
        found = {(r.get("kind"), r.get("product_id")) for r in current if r.get("source") == source["source"]}
        missing = expected - found
        if missing:
            source["ok"] = False
            source["errors"].append(f"previously tracked products missing from collection: {sorted(missing)}")


def run(args: argparse.Namespace) -> int:
    output = Path(args.output)
    fixture_dir = Path(args.fixture_dir) if args.fixture_dir else None
    prices_path = output / "prices.json"
    existing_payload = read_json(prices_path, {"observations": []})
    existing_observations = existing_payload.get("observations", []) if isinstance(existing_payload, dict) else []
    previous_status = read_json(output / "status.json", {})
    history_dir = Path(args.history_dir) if getattr(args, "history_dir", None) else None
    target_date = getattr(args, "target_date", None)
    if target_date:
        date.fromisoformat(target_date)
    archived_observations: list[dict] = []

    if args.rebuild_only:
        if not existing_observations:
            raise ValueError("rebuild-only requires stored observations")
        collected_at, source_status = validate_rebuild_metadata(existing_payload, previous_status)
        new_observations: list[dict[str, Any]] = []
    else:
        collected_at = utc_now_iso()
        source_status = []
        new_observations = []
        if args.include_trendforce:
            obs, status = collect_trendforce(fixture_dir=fixture_dir, collected_at=collected_at)
            if history_dir:
                try:
                    archive_spot(history_dir, obs, collected_at, reference=existing_observations)
                except (OSError, ValueError) as exc:
                    status["ok"] = False
                    status["errors"].append(f"daily archive: {exc}")
            new_observations.extend(obs)
            source_status.append(status)
        if args.include_memorymarket:
            obs, status = collect_memorymarket(fixture_dir=fixture_dir, collected_at=collected_at, limit_products=args.limit_products, delay=args.delay)
            new_observations.extend(obs)
            source_status.append(status)

        validate_source_coverage(existing_observations, new_observations, source_status)
        try:
            if history_dir:
                archived_observations = load_spot_archive(history_dir)
            merged_candidate = merge_observations(existing_observations, [*archived_observations, *new_observations])
            if target_date and history_dir:
                record_recovery(history_dir, merged_candidate, target_date, collected_at)
            if target_date and daily_products(merged_candidate, target_date) != REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS:
                source_dates = [row.get("date") for row in new_observations
                                if row.get("source") == "trendforce" and row.get("kind") == "spot"
                                and isinstance(row.get("date"), str)]
                latest_source_date = max(source_dates, default="unavailable")
                raise ValueError(f"target date {target_date} is missing verified daily prices; "
                                 f"latest TrendForce spot source date: {latest_source_date}; source dates are never relabeled")
        except (OSError, ValueError) as exc:
            source_status.append({"source": "daily_history", "ok": False, "observation_count": 0,
                                  "urls": [], "warnings": [], "errors": [str(exc)]})
        attempt_status = summarize_status(new_observations, source_status, collected_at)
        if getattr(args, "attempt_status", None):
            write_json(Path(args.attempt_status), attempt_status)
        if not source_status or any(not source.get("ok") or source.get("warnings") or source.get("errors")
                                    or not source.get("observation_count") for source in source_status):
            print("collection incomplete; existing output preserved", file=sys.stderr)
            for source in source_status:
                for message in [*source.get("errors", []), *source.get("warnings", [])]:
                    print(f"{source['source']}: {message}", file=sys.stderr)
            return 2

    observations = merge_observations(existing_observations, [*archived_observations, *new_observations])
    if args.rebuild_only and not observations:
        raise ValueError("rebuild-only found no valid stored price observations")

    unverified_contracts = [obs for obs in observations if obs.get("source") == "trendforce" and obs.get("kind") == "contract"
                           and (obs.get("source_last_update") or {}).get("date_source") != "table_last_update"]
    if unverified_contracts:
        raise ValueError("unverified historical contract dates; run scripts/repair_price_history.py before collecting")
    series = build_series(observations)
    status = summarize_status(observations, source_status, collected_at, history_repair=previous_status.get("history_repair"))
    write_json(prices_path, {"schema_version": SCHEMA_VERSION, "generated_at": collected_at, "observations": observations})
    write_json(output / "series.json", {"schema_version": SCHEMA_VERSION, "generated_at": collected_at, "series": series})
    write_json(output / "status.json", status)
    summary = build_public_summary(observations, series, status, collected_at)
    write_json(output / "summary.json", summary)

    action = "rebuilt from stored data" if args.rebuild_only else f"collected {len(new_observations)} new observations"
    print(f"{action}; stored {len(observations)} total observations in {output}")
    failed = [source for source in source_status if not source.get("ok")]
    return 2 if failed and not observations else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect public DRAM price data into normalized JSON files.")
    parser.add_argument("--output", default="data", help="Output directory for prices.json, series.json, and status.json")
    parser.add_argument("--fixture-dir", help="Use local fixture HTML instead of live network sources")
    parser.add_argument("--limit-products", type=int, default=None, help="Limit MemoryMarket product pages for smoke runs")
    parser.add_argument("--delay", type=float, default=0.5, help="Polite delay between MemoryMarket requests")
    parser.add_argument("--rebuild-only", action="store_true", help="Rebuild generated outputs from stored observations without fetching sources")
    parser.add_argument("--target-date", help="Require verified daily spot observations for YYYY-MM-DD; never relabel source dates")
    parser.add_argument("--history-dir", help="Persistent immutable daily source snapshots, separate from public output")
    parser.add_argument("--attempt-status", help="Record collection-attempt diagnostics separately; failures never overwrite stored outputs")
    parser.add_argument("--include-trendforce", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--include-memorymarket", action=argparse.BooleanOptionalAction, default=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
