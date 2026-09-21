#!/usr/bin/env python3
"""Build a separate corrected candidate from preserved data and frozen source HTML.

Unverified contract dates are quarantined, never guessed. Original artifacts and
excluded observations remain in the requested recovery archive.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import shutil
from urllib.parse import urlparse

from dram_tracker.collect import collect_memorymarket, collect_trendforce
from dram_tracker.model import (
    SCHEMA_VERSION, build_public_summary, build_series, merge_observations,
    read_json, summarize_status, write_json,
)

ARTIFACTS = ("prices.json", "series.json", "status.json", "summary.json", "automation-health.json")


def repair_stored_observations(observations: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    kept, quarantined, cadence_changes = [], [], []
    for original in observations:
        row = deepcopy(original)
        if row.get("source") == "trendforce" and row.get("kind") == "contract":
            update = row.get("source_last_update") or {}
            if update.get("date_source") != "table_last_update" or update.get("table_kind") != "contract":
                quarantined.append(original)
                continue
        if row.get("source") == "memorymarket":
            path = urlparse(row.get("source_url", "")).path
            expected = "monthly" if path.startswith("/price/ems/") else "weekly" if path.startswith("/price/ews/") else None
            if expected is None:
                raise ValueError(f"cannot verify MemoryMarket cadence: {row.get('source_url')}")
            if row.get("cadence") != expected:
                cadence_changes.append({"product_id": row["product_id"], "date": row["date"], "before": row.get("cadence"), "after": expected})
                row["cadence"] = expected
        kept.append(row)
    return merge_observations(kept, []), quarantined, cadence_changes


def build_candidate(source_data: Path, fixture_dir: Path, output: Path, archive: Path, collected_at: str) -> dict:
    if output.exists() or archive.exists():
        raise ValueError("output and archive must be new paths; existing recovery data will not be overwritten")
    if source_data.resolve() == output.resolve():
        raise ValueError("repair must use a separate candidate directory")
    original_payload = read_json(source_data / "prices.json", {})
    original_rows = original_payload.get("observations")
    if not isinstance(original_rows, list) or not original_rows:
        raise ValueError("repair requires a non-empty original observation snapshot")
    for name in ARTIFACTS:
        if not (source_data / name).is_file():
            raise ValueError(f"missing original artifact: {name}")
    kept, quarantined, cadence_changes = repair_stored_observations(original_rows)
    spot_contract, trend_status = collect_trendforce(fixture_dir=fixture_dir, collected_at=collected_at)
    memory_rows, memory_status = collect_memorymarket(fixture_dir=fixture_dir, collected_at=collected_at, limit_products=None, delay=0)
    sources = [trend_status, memory_status]
    if any(not s["ok"] or s["errors"] or s["warnings"] or not s["observation_count"] for s in sources):
        raise ValueError(f"frozen source verification failed: {sources}")
    current = [*spot_contract, *memory_rows]
    # Compare historical price values independently of the corrected cadence.
    originals = {(r["source"], r["kind"], r["product_id"], r["date"]): r for r in kept}
    mismatches = []
    compared = 0
    for row in current:
        previous = originals.get((row["source"], row["kind"], row["product_id"], row["date"]))
        if previous:
            compared += 1
            if previous["values"] != row["values"]:
                mismatches.append({"product_id": row["product_id"], "date": row["date"], "before": previous["values"], "after": row["values"]})
    # A changed historical value needs an explicit source revision review.
    if mismatches:
        raise ValueError(f"historical source prices differ; review before repair: {mismatches}")
    rows = merge_observations(kept, current)
    history_repair = {
        "version": 1, "repaired_at": collected_at,
        "quarantined_contract_count": len(quarantined),
        "corrected_cadence_count": len(cadence_changes),
        "policy": "Exclude contract dates without table provenance; preserve original records; never infer historical dates.",
    }
    series = build_series(rows)
    status = summarize_status(rows, sources, collected_at, history_repair=history_repair)
    report = {
        **history_repair,
        "original_observation_count": len(original_rows), "retained_observation_count": len(kept),
        "current_source_observation_count": len(current), "candidate_observation_count": len(rows),
        "compared_historical_prices": compared, "historical_price_mismatches": mismatches,
        "cadence_changes": cadence_changes,
        "original_files": {name: sha256((source_data / name).read_bytes()).hexdigest() for name in ARTIFACTS},
        "source_files": {p.name: sha256(p.read_bytes()).hexdigest() for p in sorted(fixture_dir.glob("*.html"))},
    }
    # Archive every original byte before writing the candidate; never touch source_data.
    shutil.copytree(source_data, archive / "original")
    shutil.copytree(fixture_dir, archive / "sources")
    write_json(archive / "quarantined-contract-observations.json", {"reason": history_repair["policy"], "observations": quarantined})
    write_json(archive / "repair-report.json", report)
    output.mkdir(parents=True)
    write_json(output / "prices.json", {"schema_version": SCHEMA_VERSION, "generated_at": collected_at, "observations": rows})
    write_json(output / "series.json", {"schema_version": SCHEMA_VERSION, "generated_at": collected_at, "series": series})
    write_json(output / "status.json", status)
    write_json(output / "summary.json", build_public_summary(rows, series, status, collected_at))
    # Actual GitHub automation history is preserved; a local repair is not a workflow run.
    shutil.copyfile(source_data / "automation-health.json", output / "automation-health.json")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-data", type=Path, required=True)
    parser.add_argument("--fixture-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--collected-at", required=True, help="UTC timestamp of the frozen source collection")
    args = parser.parse_args()
    report = build_candidate(args.source_data, args.fixture_dir, args.output, args.archive, args.collected_at)
    print(f"candidate={report['candidate_observation_count']}; quarantined={report['quarantined_contract_count']}; cadence corrections={report['corrected_cadence_count']}; matched historical prices={report['compared_historical_prices']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
