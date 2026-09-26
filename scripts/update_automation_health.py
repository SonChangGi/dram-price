#!/usr/bin/env python3
"""Persist DRAM automation streaks and escalate repeated degradation."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return payload if isinstance(payload, dict) else default


def status_problem_counts(status: dict[str, Any]) -> tuple[int, int, list[str]]:
    warning_count = 0
    error_count = 0
    details: list[str] = []
    sources = status.get("sources") if isinstance(status.get("sources"), list) else []
    for source in sources:
        if not isinstance(source, dict):
            continue
        name = str(source.get("source") or "unknown")
        warnings = source.get("warnings") if isinstance(source.get("warnings"), list) else []
        errors = source.get("errors") if isinstance(source.get("errors"), list) else []
        if source.get("ok") is False and not errors:
            errors = ["source status is not ok"]
        warning_count += len(warnings)
        error_count += len(errors)
        details.extend(f"{name} warning: {item}" for item in warnings[:5])
        details.extend(f"{name} error: {item}" for item in errors[:5])
    return warning_count, error_count, details


def update_health(
    previous: dict[str, Any],
    source_status: dict[str, Any],
    *,
    collection_outcome: str,
    target_outcome: str,
    tests_outcome: str,
    publication_outcome: str,
    target_date: str = "",
    now: datetime | None = None,
    alert_threshold: int = 3,
) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    warning_count, source_error_count, source_details = status_problem_counts(source_status)

    blocking_reasons = []
    if collection_outcome != "success":
        blocking_reasons.append("collection_failed" if collection_outcome == "failure" else "collection_incomplete")
    if target_outcome == "failure" or (target_date and target_outcome != "success"):
        blocking_reasons.append("target_date_missing_after_collection")
    if tests_outcome != "success":
        blocking_reasons.append("tests_failed" if tests_outcome == "failure" else "tests_incomplete")
    if publication_outcome != "success":
        blocking_reasons.append("publication_gate_failed" if publication_outcome == "failure" else "publication_gate_incomplete")
    if source_error_count:
        blocking_reasons.append(f"source_errors:{source_error_count}")

    has_warning = warning_count > 0
    has_blocking_failure = bool(blocking_reasons)
    previous_warning_streak = int(previous.get("consecutiveWarningRuns") or 0)
    previous_blocking_streak = int(previous.get("consecutiveBlockingFailures") or 0)
    warning_streak = previous_warning_streak + 1 if has_warning else 0
    blocking_streak = previous_blocking_streak + 1 if has_blocking_failure else 0
    alert_reasons = []
    if warning_streak >= alert_threshold:
        alert_reasons.append(f"source warnings persisted for {warning_streak} collection runs")
    if blocking_streak >= alert_threshold:
        alert_reasons.append(f"blocking failures persisted for {blocking_streak} collection runs")

    current_status = "blocked" if has_blocking_failure else "warning" if has_warning else "ok"
    history = previous.get("history") if isinstance(previous.get("history"), list) else []
    history = [
        *history[-19:],
        {
            "checkedAt": current.isoformat().replace("+00:00", "Z"),
            "targetDate": target_date,
            "status": current_status,
            "warningCount": warning_count,
            "sourceErrorCount": source_error_count,
            "blockingReasons": blocking_reasons,
        },
    ]
    return {
        "schemaVersion": 1,
        "contract": "dram-automation-health",
        "projectId": "dram",
        "updatedAt": current.isoformat().replace("+00:00", "Z"),
        "targetDate": target_date,
        "status": current_status,
        "collectionOutcome": collection_outcome,
        "targetVerificationOutcome": target_outcome,
        "testsOutcome": tests_outcome,
        "publicationOutcome": publication_outcome,
        "warningCount": warning_count,
        "sourceErrorCount": source_error_count,
        "details": source_details[:10],
        "blockingReasons": blocking_reasons,
        "consecutiveWarningRuns": warning_streak,
        "consecutiveBlockingFailures": blocking_streak,
        "alertThreshold": alert_threshold,
        "alertRequired": bool(alert_reasons),
        "alertReasons": alert_reasons,
        "history": history,
    }


def record_source_holiday(
    previous: dict[str, Any], *, target_date: str, source_date: str,
    holiday_name: str, holiday_url: str, now: datetime | None = None,
) -> dict[str, Any]:
    """Record a checked source closure without inventing a target-day price."""
    if not (target_date and source_date and source_date < target_date and holiday_name and holiday_url):
        raise ValueError("source holiday requires an older verified table date and calendar provenance")
    payload = update_health(previous, {}, collection_outcome="success", target_outcome="success",
                            tests_outcome="success", publication_outcome="success",
                            target_date=target_date, now=now)
    payload.update(
        status="no_publication",
        collectionOutcome="source_holiday",
        targetVerificationOutcome="not_applicable",
        testsOutcome="not_applicable",
        publicationOutcome="last_good_preserved",
        details=[f"TrendForce spot table remains dated {source_date}; {target_date} is {holiday_name}."],
        sourceHoliday={"date": target_date, "name": holiday_name, "calendarUrl": holiday_url,
                       "latestSourceDate": source_date},
    )
    payload["history"][-1]["status"] = "no_publication"
    return payload


def write_github_outputs(payload: dict[str, Any]) -> None:
    output = os.getenv("GITHUB_OUTPUT")
    if not output:
        return
    with Path(output).open("a", encoding="utf-8") as handle:
        handle.write(f"status={payload['status']}\n")
        handle.write(f"alert_required={'true' if payload['alertRequired'] else 'false'}\n")
        handle.write(f"warning_streak={payload['consecutiveWarningRuns']}\n")
        handle.write(f"blocking_streak={payload['consecutiveBlockingFailures']}\n")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path("data/automation-health.json"))
    parser.add_argument("--status", type=Path, default=Path("data/status.json"))
    parser.add_argument("--collection-outcome", required=True)
    parser.add_argument("--target-outcome", default="skipped")
    parser.add_argument("--tests-outcome", default="skipped")
    parser.add_argument("--publication-outcome", default="skipped")
    parser.add_argument("--target-date", default="")
    parser.add_argument("--alert-threshold", type=int, default=3)
    parser.add_argument("--now", help="Optional deterministic ISO timestamp")
    parser.add_argument("--source-holiday-name", default="")
    parser.add_argument("--source-date", default="")
    parser.add_argument("--source-holiday-url", default="")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    previous = read_json(args.state, {})
    source_status = read_json(args.status, {})
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else None
    if args.source_holiday_name:
        payload = record_source_holiday(
            previous, target_date=args.target_date, source_date=args.source_date,
            holiday_name=args.source_holiday_name, holiday_url=args.source_holiday_url, now=now,
        )
    else:
        payload = update_health(
            previous,
            source_status,
            collection_outcome=args.collection_outcome,
            target_outcome=args.target_outcome,
            tests_outcome=args.tests_outcome,
            publication_outcome=args.publication_outcome,
            target_date=args.target_date,
            now=now,
            alert_threshold=args.alert_threshold,
        )
    args.state.parent.mkdir(parents=True, exist_ok=True)
    args.state.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_github_outputs(payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
