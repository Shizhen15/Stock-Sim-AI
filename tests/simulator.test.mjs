import assert from "node:assert/strict";
import {
  calculatePortfolio,
  cancelOrder,
  createInitialState,
  submitOrder
} from "../src/simulator.js";

const state = createInitialState();
const before = calculatePortfolio(state);

const buy = submitOrder(state, {
  symbol: "NVDA",
  side: "BUY",
  quantity: 10,
  orderType: "MARKET",
  timeInForce: "DAY",
  thesis: "Momentum entry with defined paper risk.",
  idempotencyKey: "test-buy-nvda-10"
});

assert.equal(buy.ok, true);
assert.equal(buy.order.status, "FILLED");
assert.equal(buy.execution.symbol, "NVDA");
assert.equal(state.positions.NVDA.qty, 10);
assert.ok(calculatePortfolio(state).cash < before.cash);

const duplicate = submitOrder(state, {
  symbol: "NVDA",
  side: "BUY",
  quantity: 10,
  orderType: "MARKET",
  timeInForce: "DAY",
  idempotencyKey: "test-buy-nvda-10"
});

assert.equal(duplicate.ok, false);
assert.equal(duplicate.code, "DUPLICATE_REQUEST");
assert.equal(state.orders.filter((order) => order.idempotencyKey === "test-buy-nvda-10").length, 1);

const nakedShort = submitOrder(state, {
  symbol: "TSLA",
  side: "SELL",
  quantity: 5,
  orderType: "MARKET",
  timeInForce: "DAY",
  idempotencyKey: "test-sell-tsla-5"
});

assert.equal(nakedShort.ok, false);
assert.equal(nakedShort.order.status, "REJECTED");

const restingLimit = submitOrder(state, {
  symbol: "AAPL",
  side: "BUY",
  quantity: 1,
  orderType: "LIMIT",
  limitPrice: 100,
  timeInForce: "GTC",
  idempotencyKey: "test-resting-limit"
});

assert.equal(restingLimit.ok, true);
assert.equal(restingLimit.order.status, "ACCEPTED");
assert.equal(cancelOrder(state, restingLimit.order.id), true);
assert.equal(restingLimit.order.status, "CANCELED");

const partial = submitOrder(state, {
  symbol: "AAPL",
  side: "BUY",
  quantity: 80,
  orderType: "MARKET",
  timeInForce: "DAY",
  idempotencyKey: "test-partial-aapl"
});

assert.equal(partial.ok, true);
assert.equal(partial.order.status, "PARTIALLY_FILLED");
assert.equal(partial.execution.quantity, 48);

console.log("Simulator tests passed");
