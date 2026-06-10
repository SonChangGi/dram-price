"""Small dependency-free HTML table extraction helpers."""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser


def clean_text(value: str) -> str:
    return " ".join(unescape(value).replace("\xa0", " ").split())


@dataclass
class Table:
    rows: list[list[str]]

    @property
    def headers(self) -> list[str]:
        return self.rows[0] if self.rows else []

    @property
    def body(self) -> list[list[str]]:
        return self.rows[1:] if len(self.rows) > 1 else []


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[Table] = []
        self._table_depth = 0
        self._current_table: list[list[str]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._table_depth += 1
            if self._table_depth == 1:
                self._current_table = []
        elif self._table_depth and tag == "tr":
            self._current_row = []
        elif self._table_depth and tag in {"td", "th"}:
            self._current_cell = []
        elif self._current_cell is not None and tag in {"br", "p", "div", "li"}:
            self._current_cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._current_cell is not None:
            if self._current_row is not None:
                self._current_row.append(clean_text("".join(self._current_cell)))
            self._current_cell = None
        elif self._current_cell is not None and tag not in {"table", "tr"}:
            self._current_cell.append(" ")
        elif tag == "tr" and self._current_row is not None:
            if any(cell for cell in self._current_row):
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table" and self._table_depth:
            if self._table_depth == 1 and self._current_table:
                self.tables.append(Table(self._current_table))
            self._table_depth -= 1


def extract_tables(html: str) -> list[Table]:
    parser = TableParser()
    parser.feed(html)
    return parser.tables


def rows_as_dicts(table: Table) -> list[dict[str, str]]:
    headers = [clean_text(h) for h in table.headers]
    out: list[dict[str, str]] = []
    for row in table.body:
        item: dict[str, str] = {}
        for idx, header in enumerate(headers):
            if header:
                item[header] = row[idx] if idx < len(row) else ""
        if item:
            out.append(item)
    return out
