# DRAM Price Tracker

A personal static dashboard for tracking DRAM prices from public pages.

## What it tracks

- **TrendForce / DRAMeXchange current spot prices** from the public DRAM spot table.
- **TrendForce / DRAMeXchange current contract prices** from the public contract table.
- **MemoryMarket / CFM weekly spot proxy history** for publicly listed DRAM products, typically the past six months.

The project stores normalized JSON in `data/` and renders a static dashboard from `web/`, so it can run on GitHub Pages without a server.

The dashboard includes source, price-kind, category, product, metric, and explicit chart-series limit controls. Representative products are highlighted by default, and selecting **All products** plus **All matching series** graphs every collected series.

## Local setup

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m dram_tracker.collect --fixture-dir tests/fixtures --output tmp/test-data
PYTHONPATH=src python -m dram_tracker.collect --output data --limit-products 5
python -m http.server 8000
```

Open `http://localhost:8000/web/` after starting the static server.

## Data files

- `data/prices.json` — normalized observations.
- `data/series.json` — product/series metadata and representative defaults.
- `data/status.json` — collection timestamp, source status, counts, and caveats.

Observation fields include `source`, `kind` (`spot`, `contract`, `spot_proxy`), `cadence`, `product_id`, `product_name`, `date`, `effective_date`, `collected_at`, `currency`, and a source-specific `values` object.
When available, observations also include `category` (for example `ddr`, `rdimm`, `sodimm`, `lpddr`, `ddr4`, or `ddr5`) so the dashboard can filter source/category/product independently.

## GitHub Actions automation

Two workflows are included:

- `.github/workflows/update-data.yml` runs daily at `02:17 UTC` and on manual dispatch. It collects data, runs tests, and commits `data/` only when data changes.
- `.github/workflows/deploy-pages.yml` publishes `web/` plus `data/` to GitHub Pages when dashboard or data files change.

To enable Pages, create the repository on GitHub, push this branch, then enable **Settings → Pages → GitHub Actions**.

## Source caveats

- Public TrendForce/DRAMeXchange pages expose current tables; free historical TrendForce/DRAMeXchange data is not assumed.
- MemoryMarket publicly discloses recent weekly history for product pages and states that price data is copyrighted. Use this project for personal tracking/research and review source terms before broad redistribution.
- HTML pages can change. The collector uses a best-effort policy for this personal tracker: parser/source failures are recorded in `data/status.json`, old observations are preserved, and the command exits non-zero only when every source fails and no stored observations remain. TrendForce rows require a source update timestamp; missing source date metadata is treated as a source failure instead of inventing an effective date.

## Representative defaults

The dashboard highlights common series such as DDR5 16Gb, DDR4 16Gb 3200, DDR4 8Gb 3200, and key SO-DIMM contract rows when available. All collected products remain selectable.
