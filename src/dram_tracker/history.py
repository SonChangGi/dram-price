"""Immutable, source-dated spot snapshots for daily recovery across failed runs."""
from __future__ import annotations

import hashlib
import json
from datetime import date, time
from pathlib import Path

from dram_tracker.freshness import REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS
from dram_tracker.model import observation_price, write_json


def _bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def daily_products(rows: list[dict], target: str) -> set[str]:
    return {row.get("product_id") for row in rows
            if row.get("source") == "trendforce" and row.get("kind") == "spot"
            and row.get("cadence") == "daily" and row.get("date") == target
            and row.get("effective_date") == target
            and (row.get("source_last_update") or {}).get("date") == target
            and row.get("currency") == "USD" and (observation_price(row) or 0) > 0
            and row.get("product_id") in REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS}


def validate_snapshot(rows: list[dict]) -> str:
    if not rows:
        raise ValueError("empty daily source snapshot")
    target = rows[0].get("date", "")
    date.fromisoformat(target)
    if len(rows) != len(REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS) or daily_products(rows, target) != REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS:
        raise ValueError("daily source snapshot requires all seven products on its actual source date")
    updates = []
    for row in rows:
        update = row.get("source_last_update") or {}
        if update.get("date_source") != "table_last_update" or update.get("table_kind") != "spot" or update.get("timezone") != "GMT+8":
            raise ValueError("daily source snapshot lacks table timestamp provenance")
        time.fromisoformat(update.get("time", ""))
        digest = row.get("source_content_sha256", "")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("daily source snapshot lacks source content hash")
        updates.append((update["time"], digest))
    if len(set(updates)) != 1:
        raise ValueError("daily source snapshot mixes source sessions")
    return target


def archive_spot(root: Path, observations: list[dict], captured_at: str, *, reference: list[dict] | None = None) -> list[Path]:
    groups: dict[str, list[dict]] = {}
    for row in observations:
        if row.get("source") == "trendforce" and row.get("kind") == "spot":
            groups.setdefault(row["date"], []).append(row)
    saved = []
    accepted = [*(reference or []), *load_spot_archive(root)]
    for rows in groups.values():
        rows = sorted(rows, key=lambda row: row["product_id"])
        target = validate_snapshot(rows)
        # Repeated fetches of identical observations reuse the first immutable capture.
        identity = [{k: v for k, v in row.items() if k not in {"collected_at", "source_content_sha256"}} for row in rows]
        digest = hashlib.sha256(_bytes(identity)).hexdigest()
        session = rows[0]["source_last_update"]["time"].replace(":", "")
        path = root / target / f"{session}-{digest[:16]}.json"
        payload = {"schema_version": 1, "contract": "dram-daily-source-snapshot", "source_date": target,
                   "captured_at": captured_at, "observations_sha256": hashlib.sha256(_bytes(rows)).hexdigest(),
                   "observations": rows}
        for row in rows:
            conflicting = [old for old in accepted if old.get("source") == "trendforce" and old.get("kind") == "spot"
                           and old.get("product_id") == row["product_id"] and old.get("date") == target
                           and (old.get("source_last_update") or {}).get("time") == row["source_last_update"]["time"]
                           and old.get("values") != row.get("values")]
            if conflicting:
                quarantine = root / "conflicts" / target / path.name
                if not quarantine.exists():
                    write_json(quarantine, payload)
                raise ValueError(f"conflicting source session preserved outside accepted history: {quarantine}")
        if not path.exists():
            write_json(path, payload)
        saved.append(path)
    return saved


def load_spot_archive(root: Path) -> list[dict]:
    rows = []
    for path in sorted(root.glob("????-??-??/*.json")):
        payload = json.loads(path.read_text())
        batch = payload.get("observations", [])
        target = validate_snapshot(batch)
        if payload.get("contract") != "dram-daily-source-snapshot" or payload.get("source_date") != target or path.parent.name != target:
            raise ValueError(f"daily snapshot date/contract mismatch: {path}")
        if payload.get("observations_sha256") != hashlib.sha256(_bytes(batch)).hexdigest():
            raise ValueError(f"daily snapshot hash mismatch: {path}")
        rows.extend(batch)
    return rows


def record_recovery(root: Path, observations: list[dict], target: str, checked_at: str) -> None:
    path = root / "recovery.json"
    payload = json.loads(path.read_text()) if path.exists() else {"schema_version": 1, "dates": {}}
    dates = payload["dates"]
    dates.setdefault(target, {})
    for day, entry in dates.items():
        count = len(daily_products(observations, day))
        entry.update(observed_products=count, required_products=7, state="observed" if count == 7 else "missing")
        if day == target:
            entry["last_attempt_at"] = checked_at
    write_json(path, payload)
