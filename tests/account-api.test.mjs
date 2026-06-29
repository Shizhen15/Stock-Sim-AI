import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStockSimServer } from "../server.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "stock-sim-ai-"));
const server = createStockSimServer({
  root: process.cwd(),
  dbFile: join(tempDir, "db.json")
});

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

try {
  const aliceSignup = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({ username: "alice", password: "Secret1!" })
  });
  assert.equal(aliceSignup.status, 201);
  assert.equal(aliceSignup.body.user.username, "alice");
  assert.equal(aliceSignup.body.tradingState.orders.length, 0);

  const bobSignup = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({ username: "bob", password: "Secret2!" })
  });
  assert.equal(bobSignup.status, 201);

  const weakSignup = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({ username: "charlie", password: "secret3" })
  });
  assert.equal(weakSignup.status, 400);

  const duplicateSignup = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({ username: "alice", password: "Secret1!" })
  });
  assert.equal(duplicateSignup.status, 409);

  const badLogin = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ username: "alice", password: "wrong-password" })
  });
  assert.equal(badLogin.status, 401);

  const aliceLogin = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ username: "alice", password: "Secret1!" })
  });
  assert.equal(aliceLogin.status, 200);

  const aliceOrder = await request("/api/orders", {
    method: "POST",
    headers: { "X-User-Id": aliceLogin.body.user.id },
    body: JSON.stringify({
      symbol: "NVDA",
      side: "BUY",
      quantity: 3,
      orderType: "MARKET",
      timeInForce: "DAY",
      idempotencyKey: "alice-nvda-3"
    })
  });
  assert.equal(aliceOrder.status, 201);
  assert.equal(aliceOrder.body.tradingState.orders.length, 1);
  assert.equal(aliceOrder.body.tradingState.positions.NVDA.qty, 3);

  const bobState = await request("/api/trading-state", {
    headers: { "X-User-Id": bobSignup.body.user.id }
  });
  assert.equal(bobState.status, 200);
  assert.equal(bobState.body.tradingState.orders.length, 0);
  assert.equal(bobState.body.tradingState.positions.NVDA, undefined);

  const aliceState = await request("/api/trading-state", {
    headers: { "X-User-Id": aliceLogin.body.user.id }
  });
  assert.equal(aliceState.status, 200);
  assert.equal(aliceState.body.tradingState.orders.length, 1);
  assert.equal(aliceState.body.tradingState.positions.NVDA.qty, 3);

  console.log("Account API tests passed");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
