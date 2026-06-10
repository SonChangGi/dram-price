"""Polite HTTP fetching helpers."""

from __future__ import annotations

import time
from urllib.error import URLError
from urllib.request import Request, urlopen

USER_AGENT = "dram-price-tracker/0.1 (+https://github.com/; personal research; contact: configure-in-repo)"


def fetch_text(url: str, *, timeout: int = 30, retries: int = 2, delay: float = 1.0, user_agent: str = USER_AGENT) -> str:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"})
            with urlopen(request, timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, "replace")
        except (OSError, URLError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(delay * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")
