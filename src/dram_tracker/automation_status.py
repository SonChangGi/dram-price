"""Generate a public automation-status marker without changing price observations."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_WORKFLOW_URL = "https://github.com/SonChangGi/dram-price/actions/workflows/update-data.yml"


def build_marker(
    *,
    state: str,
    reason: str,
    target_date: str = "",
    source_step: str = "",
    workflow_url: str = DEFAULT_WORKFLOW_URL,
) -> dict[str, object]:
    if state not in {"ok", "degraded", "stale"}:
        raise ValueError(f"unsupported automation state: {state}")
    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    label = {
        "ok": "자동화 정상",
        "degraded": "자동화 점검 필요",
        "stale": "자동화 최신성 확인 필요",
    }[state]
    return {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "state": state,
        "label": label,
        "reason": reason,
        "targetDate": target_date or None,
        "sourceStep": source_step or None,
        "workflowUrl": workflow_url,
        "priceDataPolicy": "This marker never publishes newly collected price observations when collection, target-date verification, or tests fail; the site should keep the last validated data files.",
    }


def write_marker(path: Path, marker: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(marker, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write DRAM automation status marker")
    parser.add_argument("--output", type=Path, default=Path("data/automation-status.json"))
    parser.add_argument("--state", choices=["ok", "degraded", "stale"], required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--target-date", default="")
    parser.add_argument("--source-step", default="")
    parser.add_argument("--workflow-url", default=DEFAULT_WORKFLOW_URL)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    marker = build_marker(
        state=args.state,
        reason=args.reason,
        target_date=args.target_date,
        source_step=args.source_step,
        workflow_url=args.workflow_url,
    )
    write_marker(args.output, marker)
    print(f"automation_status={marker['state']}")
    print(f"automation_reason={marker['reason']}")
    print(f"automation_marker={args.output}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
