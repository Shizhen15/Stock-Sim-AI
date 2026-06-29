import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStockSimServer } from "../server.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "stock-sim-ai-"));
const dbFile = join(tempDir, "db.json");
const server = createStockSimServer({
  root: process.cwd(),
  dbFile,
  sessionTtlMs: 5000
});

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function request(path, options = {}, origin = baseUrl) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return {
    status: response.status,
    setCookie: response.headers.get("set-cookie"),
    body: await response.json()
  };
}

function cookieHeader(setCookie) {
  assert.ok(setCookie, "expected response to set a session cookie");
  return setCookie.split(";")[0];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  const aliceSignup = await request("/api/users", {
    method: "POST",
    body: JSON.stringify({ username: "alice", password: "Secret1!" })
  });
  assert.equal(aliceSignup.status, 201);
  assert.equal(aliceSignup.body.user.username, "alice");
  assert.equal(aliceSignup.body.tradingState.orders.length, 0);
  assert.match(aliceSignup.setCookie, /stock_sim_session=.*HttpOnly/);

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
  const aliceCookie = cookieHeader(aliceLogin.setCookie);

  const unauthenticatedOrder = await request("/api/orders", {
    method: "POST",
    headers: { "X-User-Id": aliceLogin.body.user.id },
    body: JSON.stringify({
      symbol: "NVDA",
      side: "BUY",
      quantity: 3,
      orderType: "MARKET",
      timeInForce: "DAY",
      idempotencyKey: "spoofed-alice-nvda-3"
    })
  });
  assert.equal(unauthenticatedOrder.status, 401);

  const aliceOrder = await request("/api/orders", {
    method: "POST",
    headers: { Cookie: aliceCookie },
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
    headers: { Cookie: cookieHeader(bobSignup.setCookie) }
  });
  assert.equal(bobState.status, 200);
  assert.equal(bobState.body.tradingState.orders.length, 0);
  assert.equal(bobState.body.tradingState.positions.NVDA, undefined);

  const spoofedBobState = await request("/api/trading-state", {
    headers: {
      Cookie: aliceCookie,
      "X-User-Id": bobSignup.body.user.id
    }
  });
  assert.equal(spoofedBobState.status, 200);
  assert.equal(spoofedBobState.body.user.username, "alice");
  assert.equal(spoofedBobState.body.tradingState.positions.NVDA.qty, 3);

  const aliceState = await request("/api/trading-state", {
    headers: { Cookie: aliceCookie }
  });
  assert.equal(aliceState.status, 200);
  assert.equal(aliceState.body.tradingState.orders.length, 1);
  assert.equal(aliceState.body.tradingState.positions.NVDA.qty, 3);

  const db = JSON.parse(await readFile(dbFile, "utf8"));
  const alice = db.users.find((user) => user.username === "alice");
  assert.match(alice.passwordHash, /^pbkdf2\$sha256\$310000\$/);
  assert.notEqual(alice.passwordHash, "Secret1!");

  const logout = await request("/api/sessions", {
    method: "DELETE",
    headers: { Cookie: aliceCookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.setCookie, /Max-Age=0/);

  const afterLogout = await request("/api/trading-state", {
    headers: { Cookie: aliceCookie }
  });
  assert.equal(afterLogout.status, 401);

  const expiryTempDir = await mkdtemp(join(tmpdir(), "stock-sim-ai-expiry-"));
  const expiryServer = createStockSimServer({
    root: process.cwd(),
    dbFile: join(expiryTempDir, "db.json"),
    sessionTtlMs: 20
  });
  await new Promise((resolve) => expiryServer.listen(0, resolve));
  try {
    const expiryBaseUrl = `http://127.0.0.1:${expiryServer.address().port}`;
    const shortSession = await request("/api/users", {
      method: "POST",
      body: JSON.stringify({ username: "expiring", password: "Secret3!" })
    }, expiryBaseUrl);
    assert.equal(shortSession.status, 201);
    await delay(40);
    const expiredState = await request("/api/trading-state", {
      headers: { Cookie: cookieHeader(shortSession.setCookie) }
    }, expiryBaseUrl);
    assert.equal(expiredState.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      expiryServer.close((error) => (error ? reject(error) : resolve()));
    });
  }

  console.log("Account API tests passed");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
