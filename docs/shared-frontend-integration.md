# DRAM shared frontend integration

## Decision

DRAM stays a static GitHub Pages application. The project has no user-facing
analysis inputs: price kind, product, source, category, metric, series emphasis,
selected chart date, row count, and theme only select or present already
published observations. The collector and Python modules remain the only source
of truth for market data.

Adding FastAPI here would create an unnecessary second runtime without making a
display filter more correct. The production frontend therefore performs only
same-origin `GET` requests for committed JSON and has no run-submission client.

## Independent shared-platform seam

The Hub packages are not published yet. `frontend/src/shared-platform/` is a
small pinned compatibility snapshot rather than a `file:` dependency or a
cross-origin runtime import:

- `contracts.ts` mirrors the shared control-kind and manifest surface.
- `control-manifest.ts` classifies every result-affecting DRAM control as
  `display` or `result_selector`; `analysis` and `operation` are rejected.
- `project-registry.ts` pins the canonical 11-project order, labels, and URLs.
- `static-result-adapter.ts` defines `dram-static-result/v1` and validates the
  existing `prices.json`, `series.json`, and `status.json` as one snapshot.
- `platform-snapshot.json` records the shared version, upstream source hashes,
  per-file hashes, and aggregate fingerprint.

Navigation, disclosure toggles, retry, and outbound links are UI actions rather
than analysis inputs. They do not change the saved result and do not belong to a
run-submission contract.

## Static result and failure boundary

The frontend tries complete same-origin data roots in order. It accepts a root
only when all required files load and the adapter verifies:

1. required fields and canonical price values;
2. matching generation timestamps across price, series, and status files;
3. exact agreement between `status.observation_count` and price rows;
4. a series definition for every observation product;
5. at least one valid observation date.

Optional automation health may be unavailable without hiding verified market
data. A malformed or mixed required snapshot is rejected; the previous screen
is never relabelled as a newly calculated result.

The adapter passes the validated observation, series, and status objects through
without calculation, normalization, reordering, or value replacement.
`summary.json` remains the separate Hub contract and is copied unchanged.

## Sync procedure

When the shared packages publish a new version:

1. Compare the new contracts, project registry, and semantic design tokens with
   the hashes in `frontend/platform-snapshot.json`.
2. Update only the compatible files in `frontend/src/shared-platform/`.
3. Update the recorded shared version, source hashes, per-file hashes, and
   aggregate fingerprint.
4. Run `npm run verify --prefix frontend`.
5. Confirm the verifier reports byte-identical repository and `dist/data` JSON.
6. Review the production UI at desktop and 390 px before release.

Do not point this project at another worktree with `file:` or import scripts/CSS
from another Pages origin. The DRAM site must remain independently reproducible.
