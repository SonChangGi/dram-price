"""MemoryMarket / CFM six-month weekly DRAM proxy adapter."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urljoin

from dram_tracker.html_tables import clean_text, extract_tables
from dram_tracker.model import slugify, utc_now_iso

BASE_URL = "https://www.memorymarket.com"
CATEGORIES = ["ddr", "rdimm", "udimm", "sodimm", "lpddr"]


def parse_number(value: str) -> float | None:
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_product_title(html: str, fallback: str = "DRAM product") -> str:
    match = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
    if not match:
        return fallback
    title = clean_text(re.sub(r"<[^>]+>", " ", match.group(1)))
    return title.split("|")[0].strip() or fallback


def discover_products(category_html: str, *, base_url: str = BASE_URL, category: str | None = None) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for href, text in re.findall(r"href=[\"']([^\"']+)[\"'][^>]*>([^<]{0,120})", category_html, re.I):
        label = clean_text(text)
        if not label or not re.search(r"/price/(?:ews|ems)/\d+", href):
            continue
        url = urljoin(base_url, href)
        product_id_match = re.search(r"/(\d+)(?:$|[?#])", href)
        product_id = product_id_match.group(1) if product_id_match else slugify(label)
        product = {"product_id": f"memorymarket-{product_id}", "product_name": label, "url": url}
        if category:
            product["category"] = category
        seen[url] = product
    return sorted(seen.values(), key=lambda item: item["product_name"])


def _history_from_tables(html: str) -> list[dict[str, Any]]:
    points: dict[str, dict[str, Any]] = {}
    for table in extract_tables(html):
        for row in table.rows:
            for cell in row:
                match = re.search(r"(\d{4}-\d{2}-\d{2})\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)", cell)
                if match:
                    date, low, high, avg = match.groups()
                    points[date] = {"date": date, "low": parse_number(low), "high": parse_number(high), "avg": parse_number(avg)}
    return [points[key] for key in sorted(points)]


def _history_from_js(html: str) -> list[dict[str, Any]]:
    # MemoryMarket embeds a chart array like: const data = [{"date":"...","value":50,"category":"Avg"}, ...];
    match = re.search(r"(?:const|var)\s+data\s*=\s*(\[.*?\])\s*;", html, re.S)
    if not match:
        return []
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    by_date: dict[str, dict[str, Any]] = {}
    for point in raw:
        date = str(point.get("date", ""))
        category = str(point.get("category", "")).lower()
        if not date or category not in {"avg", "high", "low"}:
            continue
        row = by_date.setdefault(date, {"date": date})
        row[category] = parse_number(str(point.get("value", "")))
    return [by_date[key] for key in sorted(by_date)]


def parse_product_history(
    html: str,
    *,
    url: str,
    product_name: str | None = None,
    product_id: str | None = None,
    category: str | None = None,
    collected_at: str | None = None,
) -> list[dict[str, Any]]:
    name = product_name or parse_product_title(html)
    pid = product_id or f"memorymarket-{slugify(name)}"
    collected = collected_at or utc_now_iso()
    history = _history_from_tables(html) or _history_from_js(html)
    observations: list[dict[str, Any]] = []
    for point in history:
        observations.append(
            {
                "source": "memorymarket",
                "source_url": url,
                "kind": "spot_proxy",
                "cadence": "weekly",
                "product_id": pid,
                "product_name": name,
                "category": category or "uncategorized",
                "date": point["date"],
                "effective_date": point["date"],
                "collected_at": collected,
                "currency": "USD",
                "values": {"low": point.get("low"), "high": point.get("high"), "average": point.get("avg")},
            }
        )
    return observations
