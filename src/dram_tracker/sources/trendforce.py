"""TrendForce / DRAMeXchange current price table adapter."""

from __future__ import annotations

import re
from datetime import datetime
from hashlib import sha256
from typing import Any

from dram_tracker.html_tables import extract_tables, rows_as_dicts
from dram_tracker.model import is_finite_number, observation_price, slugify, utc_now_iso

SPOT_URL = "https://www.trendforce.com/price/dram/dram_spot"
CONTRACT_URL = "https://www.trendforce.com/price/dram/dram_contract"


def parse_number(value: str) -> float | None:
    cleaned = value.replace(",", "").replace("%", "").replace("▲", "").replace("▼", "").strip()
    if not cleaned or cleaned in {"-", "N/A"}:
        return None
    try:
        number = float(cleaned)
        return number if is_finite_number(number) else None
    except ValueError:
        return None


def parse_change(value: str) -> float | None:
    number = parse_number(value)
    if number is None:
        return None
    return -abs(number) if "▼" in value and number > 0 else number


def last_update(table_context: str) -> dict[str, str]:
    """Read only the selected table's timestamp, never page-level metadata."""
    matches = list(re.finditer(r"Last\s+Update\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\(([^)]+)\)", table_context, re.I))
    if len(matches) != 1:
        raise ValueError("could not find one unambiguous TrendForce table source update timestamp")
    match = matches[0]
    date, time, tz = match.groups()
    datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")
    if tz != "GMT+8":
        raise ValueError(f"unexpected TrendForce timestamp timezone: {tz}")
    return {"date": date, "time": time, "timezone": tz, "raw": match.group(0), "date_source": "table_last_update"}


def product_category(product_name: str) -> str:
    name = product_name.lower()
    for category in ("lpddr5", "lpddr4", "ddr5", "ddr4", "ddr3"):
        if category in name:
            return category
    return "dram"


def _select_table(html: str, kind: str):
    tables = extract_tables(html)
    selected = []
    for table in tables:
        headers = set(table.headers)
        if kind == "spot" and {"Item", "Daily High", "Daily Low", "Session Average"}.issubset(headers):
            selected.append(table)
        if kind == "contract" and {"Item", "Session High", "Session Low", "Session Average", "Average Change", "Low Change"}.issubset(headers):
            selected.append(table)
    if len(selected) > 1:
        raise ValueError(f"ambiguous TrendForce {kind} price tables")
    return selected[0] if selected else None


def parse_price_page(html: str, *, kind: str, url: str, collected_at: str | None = None) -> list[dict[str, Any]]:
    if kind not in {"spot", "contract"}:
        raise ValueError(f"unsupported TrendForce kind: {kind}")
    table = _select_table(html, kind)
    if table is None:
        raise ValueError(f"could not find TrendForce {kind} price table")
    update = {**last_update(table.preceding_text), "table_kind": kind}
    update_date = update.get("date")
    if not update_date:
        raise ValueError("could not find TrendForce source update date")
    collected = collected_at or utc_now_iso()
    content_sha256 = sha256(html.encode("utf-8")).hexdigest()
    observations: list[dict[str, Any]] = []
    for row in rows_as_dicts(table):
        name = row.get("Item", "").strip()
        if not name:
            continue
        # The table footer contains a source announcement with no prices.
        # A real product with missing prices must not disappear silently.
        is_product = bool(re.match(r"^(?:LP)?DDR\d\b", name, re.I))
        if not is_product:
            if any(parse_number(row.get(key, "")) is not None for key in ("Session High", "Session Low", "Session Average")):
                raise ValueError(f"unexpected product in TrendForce {kind} table: {name}")
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
            "source_content_sha256": content_sha256,
            "collected_at": collected,
            "currency": "USD",
            "values": values,
        }
        if observation_price(observation) is not None:
            price = observation_price(observation)
            low, high = values.get("session_low"), values.get("session_high")
            if price <= 0 or (low is not None and price < low) or (high is not None and price > high):
                raise ValueError(f"invalid TrendForce price range for {name}")
            observations.append(observation)
        else:
            raise ValueError(f"missing or invalid TrendForce average for {name}")
    if not observations:
        raise ValueError(f"TrendForce {kind} table returned no valid prices")
    return observations
