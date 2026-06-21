"""Freshness decision helper for reviewed DRAM data refreshes."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class FreshnessDecision:
    should_collect: bool
    reason: str
    today: str
    generated_at: str
    generated_date: str
    target_date: str = ""
    daily_observation_count: int = 0


def _parse_utc_timestamp(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _status_dates(status_path: Path, local_tz: ZoneInfo) -> tuple[str, str, str | None]:
    if not status_path.exists():
        return "", "", "missing-status"
    try:
        payload = json.loads(status_path.read_text(encoding="utf-8"))
        generated_at = str(payload.get("generated_at") or "")
        if not generated_at:
            return "", "", "missing-generated-at"
        generated_date = _parse_utc_timestamp(generated_at).astimezone(local_tz).date().isoformat()
        return generated_at, generated_date, None
    except Exception as exc:  # noqa: BLE001 - corrupt status should trigger a safe refresh.
        return "", "", f"invalid-status:{type(exc).__name__}"


def _target_date(value: str, today: date) -> str:
    if value == "today":
        return today.isoformat()
    if value == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError("--require-daily-date must be 'today', 'yesterday', or YYYY-MM-DD") from exc


def _daily_observation_count(prices_path: Path, target_date: str) -> int:
    if not prices_path.exists():
        return 0
    payload = json.loads(prices_path.read_text(encoding="utf-8"))
    observations = payload.get("observations", []) if isinstance(payload, dict) else []
    return sum(
        1
        for obs in observations
        if isinstance(obs, dict)
        and obs.get("source") == "trendforce"
        and obs.get("kind") == "spot"
        and obs.get("cadence") == "daily"
        and obs.get("date") == target_date
    )


def decide_collection_need(
    status_path: Path,
    *,
    timezone_name: str = "Asia/Seoul",
    now: datetime | None = None,
    force: bool = False,
    prices_path: Path | None = None,
    require_daily_date: str | None = None,
    minimum_daily_spot_rows: int = 1,
) -> FreshnessDecision:
    """Return whether a collection should run for the requested local calendar day."""
    try:
        local_tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"unknown timezone: {timezone_name}") from exc

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    today = current.astimezone(local_tz).date()
    local_today = today.isoformat()
    generated_at, generated_date, status_problem = _status_dates(status_path, local_tz)

    if force:
        return FreshnessDecision(True, "forced", local_today, generated_at, generated_date)

    if require_daily_date:
        if minimum_daily_spot_rows < 1:
            raise ValueError("minimum_daily_spot_rows must be at least 1")
        if prices_path is None:
            prices_path = status_path.parent / "prices.json"
        target = _target_date(require_daily_date, today)
        if status_problem:
            return FreshnessDecision(True, status_problem, local_today, generated_at, generated_date, target, 0)
        try:
            count = _daily_observation_count(prices_path, target)
        except Exception as exc:  # noqa: BLE001 - corrupt price data should trigger a safe refresh.
            return FreshnessDecision(True, f"invalid-prices:{type(exc).__name__}", local_today, generated_at, generated_date, target, 0)
        if count >= minimum_daily_spot_rows:
            return FreshnessDecision(False, "fresh-daily-date", local_today, generated_at, generated_date, target, count)
        reason = "missing-daily-date" if count == 0 else "insufficient-daily-date"
        return FreshnessDecision(True, reason, local_today, generated_at, generated_date, target, count)

    if status_problem:
        return FreshnessDecision(True, status_problem, local_today, generated_at, generated_date)
    if generated_date >= local_today:
        return FreshnessDecision(False, "fresh", local_today, generated_at, generated_date)
    return FreshnessDecision(True, "stale", local_today, generated_at, generated_date)


def _bool_output(value: bool) -> str:
    return "true" if value else "false"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Decide whether DRAM data should be collected for the local day.")
    parser.add_argument("--status", default="data/status.json", help="Path to status.json")
    parser.add_argument("--prices", default="data/prices.json", help="Path to prices.json")
    parser.add_argument("--timezone", default="Asia/Seoul", help="Local calendar timezone used for freshness checks")
    parser.add_argument("--force", action="store_true", help="Always request collection")
    parser.add_argument(
        "--minimum-daily-spot-rows",
        type=int,
        default=1,
        help="Minimum TrendForce daily spot rows required before a date is treated as collected",
    )
    parser.add_argument(
        "--require-daily-date",
        help="Collect unless TrendForce daily spot observations already include this local date: today, yesterday, or YYYY-MM-DD",
    )
    parser.add_argument(
        "--fail-if-collect-needed",
        action="store_true",
        help="Exit non-zero after printing the decision when the date still needs collection",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    decision = decide_collection_need(
        Path(args.status),
        timezone_name=args.timezone,
        force=args.force,
        prices_path=Path(args.prices),
        require_daily_date=args.require_daily_date,
        minimum_daily_spot_rows=args.minimum_daily_spot_rows,
    )
    print(f"should_collect={_bool_output(decision.should_collect)}")
    print(f"reason={decision.reason}")
    print(f"today={decision.today}")
    print(f"generated_at={decision.generated_at}")
    print(f"generated_date={decision.generated_date}")
    print(f"target_date={decision.target_date}")
    print(f"daily_observation_count={decision.daily_observation_count}")
    return 1 if args.fail_if_collect_needed and decision.should_collect else 0


if __name__ == "__main__":
    raise SystemExit(main())
