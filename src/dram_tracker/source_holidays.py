"""Probe a documented Taiwan holiday before declaring a missing source date a failure."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from dram_tracker.freshness import REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS
from dram_tracker.http import fetch_text
from dram_tracker.sources.trendforce import SPOT_URL, parse_price_page

# Calendar dates are candidates for a source closure, never substitutes for
# observing the live table. Review each new official calendar before adding it.
CALENDAR_URL = "https://www.dgpa.gov.tw/information?pid=12685&uid=55"
HOLIDAY_CANDIDATES = {
    "2026-09-25": "Mid-Autumn Festival",
    "2026-09-28": "Teachers' Day",
    "2026-10-09": "National Day observed",
    "2026-10-26": "Taiwan Retrocession Day observed",
    "2026-12-25": "Constitution Day",
}


def previous_publication_day(target_date: str) -> str:
    day = date.fromisoformat(target_date) - timedelta(days=1)
    while day.weekday() >= 5 or day.isoformat() in HOLIDAY_CANDIDATES:
        day -= timedelta(days=1)
    return day.isoformat()


def probe(target_date: str, *, fetcher=fetch_text) -> dict[str, str]:
    date.fromisoformat(target_date)
    holiday_name = HOLIDAY_CANDIDATES.get(target_date)
    result = {"unpublished": "false", "source_date": "", "holiday_name": "", "holiday_url": ""}
    if not holiday_name:
        return result
    try:
        rows = parse_price_page(fetcher(SPOT_URL), kind="spot", url=SPOT_URL)
        dates = {row["date"] for row in rows}
        products = {row["product_id"] for row in rows}
        if len(dates) != 1 or products != REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS:
            raise ValueError("holiday probe did not find one complete dated spot table")
        source_date = dates.pop()
        # A source that is older than the preceding expected price day is stale,
        # even when today's calendar closure is documented.
        if source_date == previous_publication_day(target_date):
            result.update(unpublished="true", source_date=source_date,
                          holiday_name=holiday_name, holiday_url=CALENDAR_URL)
    except (OSError, RuntimeError, ValueError) as exc:
        # A failed probe must enter the normal strict collector and its retry path.
        print(f"holiday probe unavailable; using normal collection: {exc}", file=sys.stderr)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-date", required=True)
    result = probe(parser.parse_args(argv).target_date)
    lines = [f"{key}={value}" for key, value in result.items()]
    print("\n".join(lines))
    if os.getenv("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
