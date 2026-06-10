"""TrendForce / DRAMeXchange current price table adapter."""

from __future__ import annotations

import re
from typing import Any

from dram_tracker.html_tables import extract_tables, rows_as_dicts
from dram_tracker.model import slugify, utc_now_iso

SPOT_URL = "https://www.trendforce.com/price/dram/dram_spot"
CONTRACT_URL = "https://www.trendforce.com/price/dram/dram_contract"


def parse_number(value: str) -> float | None:
    cleaned = value.replace(",", "").replace("%", "").replace("▲", "").replace("▼", "").strip()
    if not cleaned or cleaned in {"-", "N/A"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_change(value: str) -> float | None:
    number = parse_number(value)
    if number is None:
        return None
    return -abs(number) if "▼" in value and number > 0 else number


def last_update(html: str) -> dict[str, str | None]:
    match = re.search(r"Last\s+Update\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\(([^)]+)\)", html, re.I)
    if match:
        date, time, tz = match.groups()
        return {"date": date, "time": time, "timezone": tz, "raw": match.group(0), "date_source": "last_update"}
    iso = re.search(r'"dateModified"\s*:\s*"([^"]+)"', html)
    if iso:
        raw = iso.group(1)
        return {"date": raw[:10], "time": raw[11:16] if len(raw) >= 16 else None, "timezone": raw[19:] if len(raw) > 19 else None, "raw": raw, "date_source": "date_modified"}
    raise ValueError("could not find TrendForce source update timestamp")


def product_category(product_name: str) -> str:
    name = product_name.lower()
    for category in ("lpddr5", "lpddr4", "ddr5", "ddr4", "ddr3"):
        if category in name:
            return category
    return "dram"


def _select_table(html: str, kind: str):
    tables = extract_tables(html)
    for table in tables:
        headers = set(table.headers)
        if kind == "spot" and {"Item", "Daily High", "Daily Low", "Session Average"}.issubset(headers):
            return table
        if kind == "contract" and {"Item", "Session High", "Session Low", "Session Average", "Average Change", "Low Change"}.issubset(headers):
            return table
    return None


def parse_price_page(html: str, *, kind: str, url: str, collected_at: str | None = None) -> list[dict[str, Any]]:
    if kind not in {"spot", "contract"}:
        raise ValueError(f"unsupported TrendForce kind: {kind}")
    table = _select_table(html, kind)
    if table is None:
        raise ValueError(f"could not find TrendForce {kind} price table")
    update = last_update(html)
    update_date = update.get("date")
    if not update_date:
        raise ValueError("could not find TrendForce source update date")
    collected = collected_at or utc_now_iso()
    observations: list[dict[str, Any]] = []
    for row in rows_as_dicts(table):
        name = row.get("Item", "").strip()
        if not name:
            continue
        product_id = f"trendforce-{kind}-{slugify(name)}"
        if kind == "spot":
            values = {
                "daily_high": parse_number(row.get("Daily High", "")),
                "daily_low": parse_number(row.get("Daily Low", "")),
                "session_high": parse_number(row.get("Session High", "")),
                "session_low": parse_number(row.get("Session Low", "")),
                "session_average": parse_number(row.get("Session Average", "")),
                "session_change_percent": parse_change(row.get("Session Change", "")),
            }
            cadence = "daily"
        else:
            values = {
                "session_high": parse_number(row.get("Session High", "")),
                "session_low": parse_number(row.get("Session Low", "")),
                "session_average": parse_number(row.get("Session Average", "")),
                "average_change_percent": parse_change(row.get("Average Change", "")),
                "low_change_percent": parse_change(row.get("Low Change", "")),
            }
            cadence = "monthly"
        observation = {
            "source": "trendforce",
            "source_url": url,
            "kind": kind,
            "cadence": cadence,
            "product_id": product_id,
            "product_name": name,
            "category": product_category(name),
            "date": update_date,
            "effective_date": update_date,
            "effective_month": update_date[:7],
            "source_last_update": update,
            "collected_at": collected,
            "currency": "USD",
            "values": values,
        }
        observations.append(observation)
    return observations
