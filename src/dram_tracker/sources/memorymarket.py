"""MemoryMarket / CFM public weekly and monthly DRAM proxy adapter."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any
from urllib.parse import urljoin, urlparse

from dram_tracker.html_tables import clean_text, extract_tables
from dram_tracker.model import is_finite_number, slugify, utc_now_iso

BASE_URL = "https://www.memorymarket.com"
CATEGORIES = ["ddr", "rdimm", "udimm", "sodimm", "lpddr"]


def parse_number(value: str) -> float | None:
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        number = float(cleaned)
        return number if is_finite_number(number) else None
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
                if not re.match(r"\d{4}-\d{2}-\d{2}\b", cell):
                    continue
                match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\s+(\S+)\s+(\S+)\s+(\S+)", cell)
                if not match:
                    raise ValueError("malformed MemoryMarket price history row")
                point_date, low, high, avg = match.groups()
                point = {"date": point_date, "low": parse_number(low), "high": parse_number(high), "avg": parse_number(avg)}
                if point_date in points and points[point_date] != point:
                    raise ValueError(f"conflicting MemoryMarket prices for {point_date}")
                points[point_date] = point
    return [points[key] for key in sorted(points)]


def _history_from_js(html: str) -> list[dict[str, Any]]:
    # MemoryMarket embeds a chart array like: const data = [{"date":"...","value":50,"category":"Avg"}, ...];
    match = re.search(r"(?:const|var)\s+data\s*=\s*(\[.*?\])\s*;", html, re.S)
    if not match:
        return []
    try:
        raw = json.loads(match.group(1))
    except json.JSONDecodeError:
        raise ValueError("invalid MemoryMarket chart history JSON") from None
    if not isinstance(raw, list) or not all(isinstance(point, dict) for point in raw):
        raise ValueError("invalid MemoryMarket chart history rows")
    by_date: dict[str, dict[str, Any]] = {}
    for point in raw:
        date = str(point.get("date", ""))
        category = str(point.get("category", "")).lower()
        if category not in {"avg", "high", "low"}:
            continue
        if not date:
            raise ValueError("missing MemoryMarket chart price date")
        row = by_date.setdefault(date, {"date": date})
        value = parse_number(str(point.get("value", "")))
        if category in row and row[category] != value:
            raise ValueError(f"conflicting MemoryMarket {category} prices for {date}")
        row[category] = value
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
    title = parse_product_title(html, fallback="")
    if not title:
        raise ValueError("missing MemoryMarket product title")
    if product_name is not None and clean_text(product_name) != title:
        raise ValueError(f"MemoryMarket product title mismatch: expected {product_name!r}, got {title!r}")
    name = product_name or title
    pid = product_id or f"memorymarket-{slugify(name)}"
    collected = collected_at or utc_now_iso()
    collected_date = datetime.fromisoformat(collected.replace("Z", "+00:00")).date()
    path_match = re.fullmatch(r"/price/(ews|ems)/\d+/?", urlparse(url).path)
    if not path_match:
        raise ValueError("unsupported MemoryMarket price history URL")
    cadence = "monthly" if path_match.group(1) == "ems" else "weekly"
    description = clean_text(re.sub(r"<[^>]+>", " ", html))
    if (cadence == "weekly" and "This Month's Price" in description) or (cadence == "monthly" and "This Week's Price" in description):
        raise ValueError("MemoryMarket cadence conflicts with source price description")
    history = _history_from_tables(html) or _history_from_js(html)
    if not history:
        raise ValueError("empty MemoryMarket price history")
    observations: list[dict[str, Any]] = []
    for point in history:
        try:
            point_date = date.fromisoformat(point["date"])
        except (TypeError, ValueError):
            raise ValueError(f"invalid MemoryMarket price date: {point['date']!r}") from None
        if point_date.isoformat() != point["date"] or point_date > collected_date:
            raise ValueError(f"invalid or future MemoryMarket price date: {point['date']!r}")
        low, average, high = (point.get(key) for key in ("low", "avg", "high"))
        if not all(is_finite_number(value) and value > 0 for value in (low, average, high)):
            raise ValueError(f"missing or invalid MemoryMarket price for {point['date']}")
        if not low <= average <= high:
            raise ValueError(f"MemoryMarket price range does not contain average for {point['date']}")
        observations.append(
            {
                "source": "memorymarket",
                "source_url": url,
                "kind": "spot_proxy",
                "cadence": cadence,
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
