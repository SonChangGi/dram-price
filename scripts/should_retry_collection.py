#!/usr/bin/env python3
"""Allow one whole-collection retry only for transient source fetch failures."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


TRANSIENT_FETCH = re.compile(
    r"(?:timed out|temporary failure|connection (?:reset|aborted|refused)|"
    r"remote end closed|remote disconnected|HTTP Error (?:408|500|502|503|504)\b)",
    re.IGNORECASE,
)
DERIVED_COVERAGE_ERROR = "previously tracked products missing from collection:"


def should_retry(payload: object) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("sources"), list):
        return False
    problems: list[str] = []
    for source in payload["sources"]:
        if not isinstance(source, dict):
            return False
        for field in ("warnings", "errors"):
            messages = source.get(field, [])
            if not isinstance(messages, list) or not all(isinstance(item, str) for item in messages):
                return False
            problems.extend(messages)
    fetch_failures = [message for message in problems if "failed to fetch" in message.lower()]
    return bool(fetch_failures) and all(
        ("failed to fetch" in message.lower() and TRANSIENT_FETCH.search(message))
        or message.startswith(DERIVED_COVERAGE_ERROR)
        for message in problems
    )


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        raise SystemExit("usage: should_retry_collection.py ATTEMPT_STATUS_JSON")
    try:
        payload = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 1
    if should_retry(payload):
        print("Transient source fetch failure; one isolated collection retry is allowed.")
        return 0
    print("Collection failure is not confirmed transient; leaving it for the next scheduled run.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
