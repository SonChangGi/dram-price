from __future__ import annotations

import json
import unittest

from dram_tracker.sources import memorymarket


class MemoryMarketValidationTests(unittest.TestCase):
    def parse(self, body: str, *, title: str = "DDR4 16Gb 3200", product_name: str | None = None, path: str = "ews/100222"):
        return memorymarket.parse_product_history(
            f"<title>{title} | MemoryMarket</title>{body}",
            url=f"https://www.memorymarket.com/price/{path}",
            product_name=product_name,
            collected_at="2026-09-21T10:00:00Z",
        )

    @staticmethod
    def table(*rows: str) -> str:
        return "<table>" + "".join(f"<tr><td>{row}</td></tr>" for row in rows) + "</table>"

    def test_monthly_source_preserves_reported_average_and_date(self):
        rows = self.parse(
            "<p>This Month's Price: released monthly.</p>" + self.table("2026-09-08 150 400 325"),
            title="DDR4 RDIMM 16GB 3200", path="ems/100254",
        )
        self.assertEqual(rows[0]["cadence"], "monthly")
        self.assertEqual(rows[0]["date"], "2026-09-08")
        self.assertEqual(rows[0]["values"], {"low": 150, "high": 400, "average": 325})

    def test_weekly_source_keeps_asymmetric_reported_average(self):
        row = self.parse(self.table("2026-09-15 40 70 50"))[0]
        self.assertEqual(row["cadence"], "weekly")
        self.assertEqual(row["values"]["average"], 50)

    def test_product_mismatch_including_bit_byte_case_is_rejected(self):
        for wrong in ("DDR4 8Gb 3200", "DDR4 16GB 3200"):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, "title mismatch"):
                self.parse(self.table("2026-09-15 40 70 50"), product_name=wrong)

    def test_missing_title_and_empty_history_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "product title"):
            memorymarket.parse_product_history(self.table("2026-09-15 40 70 50"), url="https://www.memorymarket.com/price/ews/100222")
        with self.assertRaisesRegex(ValueError, "empty.*history"):
            self.parse("<p>Please sign in</p>")

    def test_bad_row_cannot_be_silently_dropped_beside_valid_history(self):
        for row in ("2026-09-08 40 70 -", "2026-09-08 40 70", "2026-09-08 40 70 nan"):
            with self.subTest(row=row), self.assertRaises(ValueError):
                self.parse(self.table("2026-09-15 40 70 50", row))

    def test_invalid_dates_prices_and_ranges_are_rejected(self):
        for row in (
            "2026-02-30 40 70 50", "2026-09-22 40 70 50",
            "2026-09-15 0 70 50", "2026-09-15 -40 70 50",
            "2026-09-15 40 Infinity 50", "2026-09-15 40 70 80",
        ):
            with self.subTest(row=row), self.assertRaises(ValueError):
                self.parse(self.table(row))

    def test_conflicting_duplicate_prices_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "conflicting"):
            self.parse(self.table("2026-09-15 40 70 50", "2026-09-15 40 70 51"))

    def test_chart_missing_average_is_not_replaced_with_range_midpoint(self):
        data = [{"date": "2026-09-15", "category": key, "value": value} for key, value in (("Low", 40), ("High", 70))]
        with self.assertRaisesRegex(ValueError, "missing or invalid.*price"):
            self.parse(f"<script>const data = {json.dumps(data)};</script>")

    def test_unknown_url_and_conflicting_cadence_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "URL"):
            self.parse(self.table("2026-09-15 40 70 50"), path="other/100222")
        with self.assertRaisesRegex(ValueError, "cadence conflicts"):
            self.parse("<p>This Month's Price</p>" + self.table("2026-09-15 40 70 50"))


if __name__ == "__main__":
    unittest.main()
