#!/usr/bin/env python3
"""Small yfinance-compatible historical data scraper.

The script prefers the yfinance package when it is installed. If it is not
available, it falls back to Yahoo Finance's chart endpoint through Python's
standard library so the local demo still has one command-line integration path.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone


TIMEFRAMES = {
    "1D": {"period": "2y", "interval": "1d"},
    "1H": {"period": "60d", "interval": "60m"},
    "15m": {"period": "30d", "interval": "15m"},
}


def main() -> int:
    symbol = normalize_symbol(sys.argv[1] if len(sys.argv) > 1 else "")
    timeframe = sys.argv[2] if len(sys.argv) > 2 else "1D"
    if not symbol:
        emit(False, message="Symbol is required.")
        return 0

    options = TIMEFRAMES.get(timeframe, TIMEFRAMES["1D"])
    payload = fetch_with_yfinance(symbol, timeframe, options)
    if not payload or not payload.get("ok"):
        payload = fetch_with_chart_api(symbol, timeframe, options)
    print(json.dumps(payload, separators=(",", ":")))
    return 0


def normalize_symbol(value: str) -> str:
    return "".join(ch for ch in value.strip().upper() if ch.isalnum() or ch in ".-")


def fetch_with_yfinance(symbol: str, timeframe: str, options: dict[str, str]) -> dict | None:
    try:
        import yfinance as yf  # type: ignore
    except Exception:
        return None

    try:
        frame = yf.Ticker(symbol).history(period=options["period"], interval=options["interval"], auto_adjust=False)
        bars = []
        for timestamp, row in frame.tail(500).iterrows():
            close = row.get("Close")
            if close != close:
                continue
            bars.append(
                {
                    "time": timestamp.to_pydatetime().astimezone(timezone.utc).isoformat(),
                    "open": round_number(row.get("Open")),
                    "high": round_number(row.get("High")),
                    "low": round_number(row.get("Low")),
                    "close": round_number(close),
                    "volume": int(row.get("Volume") or 0),
                    "source": "yfinance",
                }
            )
        return {
            "ok": True,
            "symbol": symbol,
            "timeframe": timeframe,
            "source": "yfinance",
            "lastUpdated": now_iso(),
            "bars": bars,
        }
    except Exception as error:
        return {"ok": False, "message": f"yfinance failed: {error}"}


def fetch_with_chart_api(symbol: str, timeframe: str, options: dict[str, str]) -> dict:
    query = urllib.parse.urlencode({"range": options["period"], "interval": options["interval"]})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{query}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "stock-sim-ai-local/0.1"})
        with urllib.request.urlopen(request, timeout=4) as response:
            data = json.loads(response.read().decode("utf-8"))

        result = data["chart"]["result"][0]
        timestamps = result.get("timestamp") or []
        quote = result["indicators"]["quote"][0]
        bars = []
        for index, epoch in enumerate(timestamps[-500:]):
            source_index = len(timestamps) - len(timestamps[-500:]) + index
            close = item_at(quote.get("close"), source_index)
            if close is None:
                continue
            bars.append(
                {
                    "time": datetime.fromtimestamp(epoch, timezone.utc).isoformat(),
                    "open": round_number(item_at(quote.get("open"), source_index)),
                    "high": round_number(item_at(quote.get("high"), source_index)),
                    "low": round_number(item_at(quote.get("low"), source_index)),
                    "close": round_number(close),
                    "volume": int(item_at(quote.get("volume"), source_index) or 0),
                    "source": "yahoo-chart",
                }
            )

        return {
            "ok": True,
            "symbol": symbol,
            "timeframe": timeframe,
            "source": "Yahoo Finance chart API",
            "lastUpdated": now_iso(),
            "bars": bars,
        }
    except Exception as error:
        return {"ok": False, "message": f"Yahoo chart scrape failed: {error}"}


def item_at(values, index: int):
    if not values or index >= len(values):
        return None
    return values[index]


def round_number(value):
    return None if value is None else round(float(value), 4)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit(ok: bool, **payload) -> None:
    print(json.dumps({"ok": ok, **payload}, separators=(",", ":")))


if __name__ == "__main__":
    raise SystemExit(main())
