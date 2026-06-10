from __future__ import annotations

import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dram_tracker.sources import memorymarket, trendforce

FIXTURES = Path(__file__).parent / "fixtures"


class ParserTests(unittest.TestCase):
    def test_trendforce_spot_parser_extracts_current_rows(self) -> None:
        html = (FIXTURES / "trendforce_spot.html").read_text(encoding="utf-8")
        rows = trendforce.parse_price_page(html, kind="spot", url=trendforce.SPOT_URL, collected_at="2026-06-10T00:00:00Z")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["kind"], "spot")
        self.assertEqual(rows[0]["cadence"], "daily")
        self.assertEqual(rows[0]["category"], "ddr5")
        self.assertEqual(rows[0]["date"], "2026-06-10")
        self.assertEqual(rows[0]["values"]["session_average"], 44.5)
        self.assertEqual(rows[1]["values"]["session_change_percent"], -0.96)

    def test_trendforce_contract_parser_extracts_contract_rows(self) -> None:
        html = (FIXTURES / "trendforce_contract.html").read_text(encoding="utf-8")
        rows = trendforce.parse_price_page(html, kind="contract", url=trendforce.CONTRACT_URL, collected_at="2026-06-10T00:00:00Z")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["kind"], "contract")
        self.assertEqual(rows[0]["cadence"], "monthly")
        self.assertEqual(rows[0]["effective_month"], "2026-06")
        self.assertEqual(rows[0]["values"]["average_change_percent"], 45.33)

    def test_memorymarket_discovers_dram_product_links(self) -> None:
        html = (FIXTURES / "memorymarket_category_ddr.html").read_text(encoding="utf-8")
        products = memorymarket.discover_products(html)
        self.assertEqual([p["product_id"] for p in products], ["memorymarket-100222", "memorymarket-100221"])
        self.assertEqual(products[0]["url"], "https://www.memorymarket.com/price/ews/100222")
        categorized = memorymarket.discover_products(html, category="ddr")
        self.assertEqual(categorized[0]["category"], "ddr")

    def test_memorymarket_history_parser_extracts_weekly_table_rows(self) -> None:
        html = (FIXTURES / "memorymarket_product_100222.html").read_text(encoding="utf-8")
        rows = memorymarket.parse_product_history(
            html,
            url="https://www.memorymarket.com/price/ews/100222",
            product_id="memorymarket-100222",
            category="ddr",
            collected_at="2026-06-10T00:00:00Z",
        )
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[-1]["date"], "2026-06-09")
        self.assertEqual(rows[-1]["kind"], "spot_proxy")
        self.assertEqual(rows[-1]["cadence"], "weekly")
        self.assertEqual(rows[-1]["category"], "ddr")
        self.assertEqual(rows[-1]["values"], {"low": 40.0, "high": 70.0, "average": 50.0})

    def test_memorymarket_history_parser_falls_back_to_chart_data(self) -> None:
        html = (FIXTURES / "memorymarket_product_100221.html").read_text(encoding="utf-8")
        rows = memorymarket.parse_product_history(html, url="https://www.memorymarket.com/price/ews/100221", product_id="memorymarket-100221", collected_at="2026-06-10T00:00:00Z")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["values"], {"low": 18.0, "high": 30.0, "average": 22.0})

    def test_trendforce_requires_source_update_timestamp(self) -> None:
        html = """
        <table>
          <tr><th>Item</th><th>Daily High</th><th>Daily Low</th><th>Session High</th><th>Session Low</th><th>Session Average</th><th>Session Change</th></tr>
          <tr><td>DDR5 16Gb (2Gx8) 4800/5600</td><td>4</td><td>3</td><td>4</td><td>3</td><td>3.5</td><td>0%</td></tr>
        </table>
        """
        with self.assertRaisesRegex(ValueError, "source update timestamp"):
            trendforce.parse_price_page(html, kind="spot", url=trendforce.SPOT_URL, collected_at="2026-06-10T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
