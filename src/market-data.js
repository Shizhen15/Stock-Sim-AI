import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { instruments as demoInstruments, demoBars, round } from "./simulator.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const historyScript = join(moduleDir, "..", "scripts", "yfinance_history.py");
const alpacaBaseUrl = process.env.ALPACA_MARKET_DATA_URL || "https://data.alpaca.markets";
const alpacaFeed = process.env.ALPACA_FEED || "iex";
const quoteCacheTtlMs = Number(process.env.ALPACA_QUOTE_CACHE_MS || 60000);
const maxAlpacaRequestsPerMinute = Number(process.env.ALPACA_MAX_REQUESTS_PER_MINUTE || 120);
const historyTimeoutMs = Number(process.env.YFINANCE_TIMEOUT_MS || 4500);

const quoteCache = new Map();
const alpacaRequestTimes = [];

export function listInstruments() {
  return demoInstruments.map((instrument) => ({ ...instrument }));
}

export function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export async function getLatestQuote(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const fallback = demoInstruments.find((item) => item.symbol === symbol);
  if (!symbol || !fallback) {
    return { ok: false, status: 404, error: "UNKNOWN_SYMBOL", message: "Unknown or unsupported US stock / ETF symbol." };
  }

  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.receivedAtMs < quoteCacheTtlMs) {
    return { ok: true, quote: { ...cached.quote, cache: "hit" } };
  }

  const alpacaQuote = await fetchAlpacaLatestQuote(symbol, fallback);
  quoteCache.set(symbol, {
    quote: alpacaQuote,
    receivedAtMs: Date.now()
  });
  return { ok: true, quote: alpacaQuote };
}

export async function getHistoricalBars(symbolInput, timeframeInput = "1D", includeExtendedHours = false) {
  const symbol = normalizeSymbol(symbolInput);
  const timeframe = normalizeTimeframe(timeframeInput);
  const instrument = demoInstruments.find((item) => item.symbol === symbol);
  if (!symbol || !instrument) {
    return { ok: false, status: 404, error: "UNKNOWN_SYMBOL", message: "Unknown or unsupported US stock / ETF symbol." };
  }

  const scraped = await scrapeYfinanceBars(symbol, timeframe, includeExtendedHours);
  if (scraped.ok && scraped.bars.length) {
    return {
      ok: true,
      symbol,
      timeframe,
      includeExtendedHours,
      source: scraped.source,
      isRealtime: false,
      lastUpdated: scraped.lastUpdated,
      bars: scraped.bars
    };
  }

  const bars = buildDemoBars(instrument, timeframe);
  return {
    ok: true,
    symbol,
    timeframe,
    includeExtendedHours,
    source: "Demo historical fallback",
    isRealtime: false,
    warning: scraped.message || "Historical scraper unavailable; using generated demo bars.",
    lastUpdated: new Date().toISOString(),
    bars
  };
}

export function getAlpacaLimiterState() {
  pruneAlpacaRequestTimes();
  return {
    configuredLimitPerMinute: maxAlpacaRequestsPerMinute,
    usedInCurrentWindow: alpacaRequestTimes.length,
    cacheTtlMs: quoteCacheTtlMs,
    feed: alpacaFeed
  };
}

async function fetchAlpacaLatestQuote(symbol, fallback) {
  const key = process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY;
  if (!key || !secret) {
    return demoQuote(symbol, fallback, "Demo delayed quote; Alpaca credentials not configured");
  }

  if (!canUseAlpacaRequest()) {
    return demoQuote(symbol, fallback, "Demo delayed quote; Alpaca free-tier guard active");
  }

  recordAlpacaRequest();
  const url = `${alpacaBaseUrl}/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=${encodeURIComponent(alpacaFeed)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": key,
        "APCA-API-SECRET-KEY": secret
      }
    });

    if (!response.ok) {
      return demoQuote(symbol, fallback, `Demo delayed quote; Alpaca returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const quote = payload.quote || {};
    const ask = Number(quote.ap);
    const bid = Number(quote.bp);
    const price = Number.isFinite(ask) && Number.isFinite(bid) && bid > 0
      ? round((ask + bid) / 2, 2)
      : fallback.price;
    return {
      symbol,
      price,
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      changePct: fallback.changePct,
      volume: fallback.volume,
      marketCap: fallback.marketCap,
      pe: fallback.pe,
      source: `Alpaca ${alpacaFeed.toUpperCase()} latest quote`,
      provider: "alpaca",
      isRealtime: true,
      eventTime: quote.t || new Date().toISOString(),
      receivedTime: new Date().toISOString(),
      cache: "miss"
    };
  } catch (error) {
    return demoQuote(symbol, fallback, `Demo delayed quote; Alpaca unavailable: ${error.message}`);
  }
}

function canUseAlpacaRequest() {
  pruneAlpacaRequestTimes();
  return alpacaRequestTimes.length < maxAlpacaRequestsPerMinute;
}

function recordAlpacaRequest() {
  alpacaRequestTimes.push(Date.now());
}

function pruneAlpacaRequestTimes() {
  const cutoff = Date.now() - 60000;
  while (alpacaRequestTimes.length && alpacaRequestTimes[0] < cutoff) {
    alpacaRequestTimes.shift();
  }
}

function demoQuote(symbol, fallback, source) {
  return {
    symbol,
    price: fallback.price,
    bid: null,
    ask: null,
    changePct: fallback.changePct,
    volume: fallback.volume,
    marketCap: fallback.marketCap,
    pe: fallback.pe,
    source,
    provider: "demo",
    isRealtime: false,
    eventTime: fallback.updatedAt,
    receivedTime: new Date().toISOString(),
    cache: "miss"
  };
}

function normalizeTimeframe(value) {
  return ["1D", "1H", "15m"].includes(value) ? value : "1D";
}

function scrapeYfinanceBars(symbol, timeframe, includeExtendedHours) {
  return new Promise((resolve) => {
    execFile("python", [historyScript, symbol, timeframe, includeExtendedHours ? "1" : "0"], { timeout: historyTimeoutMs }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, message: error.message });
        return;
      }

      try {
        const payload = JSON.parse(stdout);
        resolve(payload.ok ? payload : { ok: false, message: payload.message || "Invalid scraper response." });
      } catch (parseError) {
        resolve({ ok: false, message: parseError.message });
      }
    });
  });
}

function buildDemoBars(instrument, timeframe) {
  const intervalMs = timeframe === "15m" ? 15 * 60 * 1000 : timeframe === "1H" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const now = Date.now();
  return demoBars.map((value, index) => {
    const close = round(instrument.price * (value / demoBars.at(-1)), 2);
    const open = round(close * (1 + ((index % 5) - 2) / 1000), 2);
    const high = round(Math.max(open, close) * 1.006, 2);
    const low = round(Math.min(open, close) * 0.994, 2);
    return {
      time: new Date(now - (demoBars.length - 1 - index) * intervalMs).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000000 + index * 25000,
      source: "demo"
    };
  });
}
