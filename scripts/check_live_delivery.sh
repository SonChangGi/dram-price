#!/usr/bin/env bash
# Check delivery independently of collection freshness. A previously committed
# bundle may need redeployment when its original Pages job was interrupted.
set -euo pipefail

readback="$(mktemp "${RUNNER_TEMP:?}/dram-delivery.XXXXXX")"
trap 'rm -f "$readback"' EXIT

needs_redeploy=false
for path in data/prices.json data/series.json data/status.json data/summary.json data/automation-health.json; do
    code="$(curl --silent --show-error --location --retry 2 --retry-max-time 25 \
        --connect-timeout 5 --max-time 10 --header 'Cache-Control: no-cache' \
        --output "$readback" --write-out '%{http_code}' \
        "${PAGE_URL%/}/$path?delivery=${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}")"
    case "$code" in
        200)
            if cmp --silent "$path" "$readback"; then
                continue
            fi
            ;;
        404|410) ;;
        *)
            echo "::error::Cannot verify live DRAM $path (HTTP $code)."
            exit 1
            ;;
    esac
    echo "::warning::Live DRAM $path differs from the verified checkout; a recovery deploy is needed."
    needs_redeploy=true
done
echo "needs_redeploy=$needs_redeploy" >> "${GITHUB_OUTPUT:?}"
