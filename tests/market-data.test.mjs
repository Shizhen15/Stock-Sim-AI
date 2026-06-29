import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

delete process.env.ALPACA_API_KEY_ID;
delete process.env.ALPACA_API_SECRET_KEY;
delete process.env.APCA_API_KEY_ID;
delete process.env.APCA_API_SECRET_KEY;
process.env.ALPACA_MAX_REQUESTS_PER_MINUTE = "2";
process.env.ALPACA_QUOTE_CACHE_MS = "60000";
process.env.YFINANCE_TIMEOUT_MS = "50";

const { createStockSimServer } = await import("../server.mjs");

const tempDir = await mkdtemp(join(tmpdir(), "stock-sim-ai-market-data-"));
const server = createStockSimServer({
  root: process.cwd(),
  dbFile: join(tempDir, "db.json")
});

await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    body: await response.json()
  };
}

try {
  const instruments = await request("/api/market-data/instruments");
  assert.equal(instruments.status, 200);
  assert.ok(instruments.body.instruments.some((item) => item.symbol === "AAPL"));
  assert.ok(instruments.body.instruments.some((item) => item.symbol === "META"));
  assert.ok(instruments.body.instruments.some((item) => item.symbol === "PLTR"));

  const firstQuote = await request("/api/market-data/quote?symbol=AAPL");
  assert.equal(firstQuote.status, 200);
  assert.equal(firstQuote.body.quote.symbol, "AAPL");
  assert.equal(firstQuote.body.quote.provider, "demo");
  assert.equal(firstQuote.body.alpacaLimiter.configuredLimitPerMinute, 2);

  const metaQuote = await request("/api/market-data/quote?symbol=META");
  assert.equal(metaQuote.status, 200);
  assert.equal(metaQuote.body.quote.symbol, "META");

  const secondQuote = await request("/api/market-data/quote?symbol=AAPL");
  assert.equal(secondQuote.status, 200);
  assert.equal(secondQuote.body.quote.cache, "hit");

  const bars = await request("/api/market-data/bars?symbol=AAPL&timeframe=1D");
  assert.equal(bars.status, 200);
  assert.equal(bars.body.symbol, "AAPL");
  assert.equal(bars.body.timeframe, "1D");
  assert.equal(bars.body.includeExtendedHours, false);
  assert.ok(bars.body.bars.length >= 20);
  assert.ok(Number.isFinite(bars.body.bars.at(-1).close));

  const extendedBars = await request("/api/market-data/bars?symbol=AAPL&timeframe=15m&extendedHours=1");
  assert.equal(extendedBars.status, 200);
  assert.equal(extendedBars.body.symbol, "AAPL");
  assert.equal(extendedBars.body.timeframe, "15m");
  assert.equal(extendedBars.body.includeExtendedHours, true);
  assert.ok(extendedBars.body.bars.length >= 20);

  const unknown = await request("/api/market-data/quote?symbol=NOPE");
  assert.equal(unknown.status, 404);

  console.log("Market data API tests passed");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
