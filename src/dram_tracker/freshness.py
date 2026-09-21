"""Freshness decision helper for reviewed DRAM data refreshes."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dram_tracker.model import observation_price


# The tracked public TrendForce spot table. Additional products do not compensate
# for a missing tracked product when the workflow assesses daily completeness.
REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS = frozenset({
    "trendforce-spot-ddr3-4gb-512mx8-1600-1866",
    "trendforce-spot-ddr4-16gb-2gx8-3200",
    "trendforce-spot-ddr4-16gb-2gx8-ett",
    "trendforce-spot-ddr4-8gb-1gx8-3200",
    "trendforce-spot-ddr4-8gb-1gx8-ett",
    "trendforce-spot-ddr5-16gb-2gx8-4800-5600",
    "trendforce-spot-ddr5-16gb-2gx8-ett",
})


# GitHub cron uses UTC; tuple values are the corresponding Korean wall-clock
# slot, target-day offset, and allowed local weekdays (Monday is zero).
SCHEDULE_SLOTS = {
    "15 4 * * 1-5": (13, 15, 0, frozenset(range(5))),
    "15 6 * * 1-5": (15, 15, 0, frozenset(range(5))),
    "30 10 * * 1-5": (19, 30, 0, frozenset(range(5))),
    "30 13 * * 1-5": (22, 30, 0, frozenset(range(5))),
    "30 16 * * 1-5": (1, 30, -1, frozenset(range(1, 6))),
    "30 19 * * 1-5": (4, 30, -1, frozenset(range(1, 6))),
}
INTRADAY_SCHEDULES = frozenset({"15 4 * * 1-5", "15 6 * * 1-5", "30 10 * * 1-5"})


def scheduled_target_date(run_created_at: datetime, schedule: str) -> str:
    """Resolve the most recent scheduled slot from the immutable run timestamp.

    A queued 22:30 run that starts after midnight still targets the preceding
    price day. Re-running that same GitHub run preserves the same target.
    """
    if schedule not in SCHEDULE_SLOTS:
        raise ValueError(f"unknown DRAM collection schedule: {schedule}")
    hour, minute, offset, weekdays = SCHEDULE_SLOTS[schedule]
    if run_created_at.tzinfo is None:
        raise ValueError("scheduled run timestamp must include a timezone")
    local = run_created_at.astimezone(ZoneInfo("Asia/Seoul"))
    slot = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if slot > local:
        slot -= timedelta(days=1)
    while slot.weekday() not in weekdays:
        slot -= timedelta(days=1)
    return (slot.date() + timedelta(days=offset)).isoformat()


@dataclass(frozen=True)
class FreshnessDecision:
    should_collect: bool
    reason: str
    today: str
    generated_at: str
    generated_date: str
    target_date: str = ""
    daily_observation_count: int = 0
    minimum_source_time: str = ""


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


def _daily_observation_count(prices_path: Path, target_date: str, *, require_known_products: bool = False,
                             minimum_source_time: str | None = None) -> int:
    if not prices_path.exists():
        return 0
    payload = json.loads(prices_path.read_text(encoding="utf-8"))
    observations = payload.get("observations", []) if isinstance(payload, dict) else []
    products: set[str] = set()
    for obs in observations:
        if not isinstance(obs, dict):
            continue
        update = obs.get("source_last_update")
        if not isinstance(update, dict):
            continue
        if minimum_source_time:
            source_time = update.get("time")
            if not isinstance(source_time, str) or update.get("timezone") != "GMT+8":
                continue
            try:
                normalized_time = datetime.strptime(source_time, "%H:%M").strftime("%H:%M")
            except ValueError:
                continue
            if source_time != normalized_time or source_time < minimum_source_time:
                continue
        price = observation_price(obs)
        product_id = obs.get("product_id")
        if (
            obs.get("source") == "trendforce"
            and obs.get("kind") == "spot"
            and obs.get("cadence") == "daily"
            and obs.get("date") == target_date
            and obs.get("effective_date") == target_date
            and update.get("date") == target_date
            and update.get("date_source") in {"last_update", "table_last_update"}
            and (update.get("date_source") != "table_last_update" or update.get("table_kind") == "spot")
            and isinstance(product_id, str) and bool(product_id.strip())
            and obs.get("currency") == "USD"
            and price is not None and price > 0
        ):
            products.add(product_id)
    if require_known_products:
        products.intersection_update(REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS)
    return len(products)


def decide_collection_need(
    status_path: Path,
    *,
    timezone_name: str = "Asia/Seoul",
    now: datetime | None = None,
    force: bool = False,
    prices_path: Path | None = None,
    require_daily_date: str | None = None,
    minimum_daily_spot_rows: int = 1,
    require_known_spot_products: bool = False,
    schedule: str | None = None,
    minimum_source_time: str | None = None,
) -> FreshnessDecision:
    """Return whether a collection should run for the requested local calendar day."""
    try:
        local_tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"unknown timezone: {timezone_name}") from exc

    if schedule and now is None:
        raise ValueError("scheduled collection requires the immutable run creation timestamp")
    current = now or datetime.now(timezone.utc)
    if schedule and current.tzinfo is None:
        raise ValueError("scheduled run timestamp must include a timezone")
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    today = current.astimezone(local_tz).date()
    local_today = today.isoformat()
    generated_at, generated_date, status_problem = _status_dates(status_path, local_tz)
    if schedule:
        if require_daily_date not in {None, "today"}:
            raise ValueError("an explicit date cannot override a scheduled recovery target")
        require_daily_date = scheduled_target_date(current, schedule)
        # Every daytime slot observes subsequent source sessions for the same day.
        force = force or schedule in INTRADAY_SCHEDULES
        if schedule not in INTRADAY_SCHEDULES:
            minimum_source_time = minimum_source_time or "17:50"
    if minimum_source_time:
        normalized_time = datetime.strptime(minimum_source_time, "%H:%M").strftime("%H:%M")
        if normalized_time != minimum_source_time:
            raise ValueError("minimum source time must be HH:MM in GMT+8")

    if force:
        target = _target_date(require_daily_date, today) if require_daily_date else ""
        return FreshnessDecision(True, "forced", local_today, generated_at, generated_date, target, 0, minimum_source_time or "")

    if require_daily_date:
        if minimum_daily_spot_rows < 1:
            raise ValueError("minimum_daily_spot_rows must be at least 1")
        if prices_path is None:
            prices_path = status_path.parent / "prices.json"
        target = _target_date(require_daily_date, today)
        if status_problem:
            return FreshnessDecision(True, status_problem, local_today, generated_at, generated_date, target, 0, minimum_source_time or "")
        try:
            count = _daily_observation_count(prices_path, target, require_known_products=require_known_spot_products, minimum_source_time=minimum_source_time)
        except Exception as exc:  # noqa: BLE001 - corrupt price data should trigger a safe refresh.
            return FreshnessDecision(True, f"invalid-prices:{type(exc).__name__}", local_today, generated_at, generated_date, target, 0, minimum_source_time or "")
        required_count = max(minimum_daily_spot_rows, len(REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS)) if require_known_spot_products else minimum_daily_spot_rows
        if count >= required_count:
            return FreshnessDecision(False, "fresh-daily-date", local_today, generated_at, generated_date, target, count, minimum_source_time or "")
        reason = "missing-daily-date" if count == 0 else "insufficient-daily-date"
        if minimum_source_time:
            date_count = _daily_observation_count(prices_path, target, require_known_products=require_known_spot_products)
            if date_count >= required_count:
                reason = "missing-required-source-session" if count == 0 else "insufficient-required-source-session"
        return FreshnessDecision(True, reason, local_today, generated_at, generated_date, target, count, minimum_source_time or "")

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
    parser.add_argument("--now", help="Immutable GitHub run created_at ISO timestamp; reused across delayed/re-run jobs")
    parser.add_argument("--schedule", help="Known GitHub UTC cron expression; resolves the intended price date")
    parser.add_argument("--minimum-source-time", help="Require every counted product to reach this source HH:MM (GMT+8)")
    parser.add_argument(
        "--minimum-daily-spot-rows",
        type=int,
        default=1,
        help="Minimum TrendForce daily spot rows required before a date is treated as collected",
    )
    parser.add_argument("--require-known-spot-products", action="store_true",
                        help="Require every tracked TrendForce spot product; extra products cannot fill missing coverage")
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
        now=datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else None,
        schedule=args.schedule,
        minimum_source_time=args.minimum_source_time or None,
        force=args.force,
        prices_path=Path(args.prices),
        require_daily_date=args.require_daily_date,
        minimum_daily_spot_rows=args.minimum_daily_spot_rows,
        require_known_spot_products=args.require_known_spot_products,
    )
    print(f"should_collect={_bool_output(decision.should_collect)}")
    print(f"reason={decision.reason}")
    print(f"today={decision.today}")
    print(f"generated_at={decision.generated_at}")
    print(f"generated_date={decision.generated_date}")
    print(f"target_date={decision.target_date}")
    print(f"daily_observation_count={decision.daily_observation_count}")
    print(f"minimum_source_time={decision.minimum_source_time}")
    return 1 if args.fail_if_collect_needed and decision.should_collect else 0


if __name__ == "__main__":
    raise SystemExit(main())
