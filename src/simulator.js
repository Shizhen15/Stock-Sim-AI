// Demo 行情主数据。真实产品里这些数据会来自行情供应商和数据库。
export const instruments = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    sector: "Technology",
    price: 214.62,
    changePct: 1.18,
    volume: "58.4M",
    marketCap: "3.29T",
    pe: 31.4,
    source: "Demo delayed quote",
    updatedAt: "2026-06-16 09:45 ET"
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    sector: "Semiconductors",
    price: 145.18,
    changePct: -0.74,
    volume: "44.9M",
    marketCap: "3.57T",
    pe: 38.1,
    source: "Demo delayed quote",
    updatedAt: "2026-06-16 09:45 ET"
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF",
    sector: "ETF",
    price: 612.33,
    changePct: 0.32,
    volume: "31.2M",
    marketCap: "629.8B",
    pe: 24.8,
    source: "Demo delayed quote",
    updatedAt: "2026-06-16 09:45 ET"
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    sector: "Consumer Discretionary",
    price: 181.76,
    changePct: -1.93,
    volume: "72.1M",
    marketCap: "579.6B",
    pe: 52.6,
    source: "Demo delayed quote",
    updatedAt: "2026-06-16 09:45 ET"
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    sector: "Technology",
    price: 489.02,
    changePct: 0.84,
    volume: "21.8M",
    marketCap: "3.63T",
    pe: 34.9,
    source: "Demo delayed quote",
    updatedAt: "2026-06-16 09:45 ET"
  }
];

export const demoBars = [
  189, 194, 191, 198, 203, 201, 207, 211, 209, 214, 218, 215, 221, 224, 219, 226,
  232, 228, 235, 241, 238, 244, 249, 246
];

// 创建一份全新的模拟账户状态。页面刷新后会重新初始化，不做持久化存储。
export function createInitialState() {
  return {
    cash: 100000,
    startingEquity: 100000,
    benchmarkReturnPct: 4.2,
    orders: [],
    executions: [],
    theses: [],
    idempotencyKeys: new Set(),
    positions: {
      AAPL: { symbol: "AAPL", qty: 40, avgCost: 196.1, realizedPnl: 0 },
      SPY: { symbol: "SPY", qty: 20, avgCost: 588.4, realizedPnl: 0 }
    },
    watchlists: {
      Core: ["AAPL", "NVDA", "SPY"],
      Momentum: ["NVDA", "TSLA", "MSFT"]
    },
    alerts: [
      { symbol: "NVDA", condition: "Price above 150.00", status: "Active" },
      { symbol: "SPY", condition: "Daily change below -1.00%", status: "Active" }
    ],
    auditLog: [
      "Account created with USD 100,000 virtual cash",
      "User accepted simulated trading and non-advice disclosure"
    ]
  };
}

export function getInstrument(symbol) {
  return instruments.find((item) => item.symbol === symbol);
}

export function marketValue(position) {
  const instrument = getInstrument(position.symbol);
  return instrument ? position.qty * instrument.price : 0;
}

// 根据现金、持仓和最新 demo 价格计算组合视图。
// 注意：这里没有直接保存净值，而是每次渲染时重新计算，避免数据不同步。
export function calculatePortfolio(state) {
  const positions = Object.values(state.positions).filter((position) => position.qty !== 0);
  const positionsValue = positions.reduce((total, position) => total + marketValue(position), 0);
  const unrealizedPnl = positions.reduce((total, position) => {
    const instrument = getInstrument(position.symbol);
    return total + (instrument.price - position.avgCost) * position.qty;
  }, 0);
  const realizedPnl = positions.reduce((total, position) => total + position.realizedPnl, 0);
  const equity = state.cash + positionsValue;
  const cumulativeReturnPct = ((equity - state.startingEquity) / state.startingEquity) * 100;

  return {
    cash: state.cash,
    buyingPower: state.cash,
    positions,
    positionsValue,
    unrealizedPnl,
    realizedPnl,
    equity,
    cumulativeReturnPct,
    dailyReturnPct: 0.76,
    maxDrawdownPct: -2.4,
    volatilityPct: 13.8,
    winRatePct: 62,
    profitFactor: 1.7,
    benchmarkReturnPct: state.benchmarkReturnPct
  };
}

// 下单入口：把表单输入转换成订单，先做幂等和风控校验，再交给成交模拟器。
// 这对应需求文档里的 OMS/Risk + Execution Simulator 的简化版本。
export function submitOrder(state, input) {
  const symbol = String(input.symbol || "").trim().toUpperCase();
  const side = input.side === "SELL" ? "SELL" : "BUY";
  const quantity = Number(input.quantity);
  const orderType = input.orderType || "MARKET";
  const limitPrice = Number(input.limitPrice || 0);
  const stopPrice = Number(input.stopPrice || 0);
  const timeInForce = input.timeInForce || "DAY";
  const thesis = String(input.thesis || "").trim();
  const idempotencyKey = input.idempotencyKey || `${symbol}-${side}-${quantity}-${Date.now()}`;
  const instrument = getInstrument(symbol);

  // 幂等键用于防止用户重复点击或网络重试时生成两笔相同订单。
  if (state.idempotencyKeys.has(idempotencyKey)) {
    return {
      ok: false,
      code: "DUPLICATE_REQUEST",
      message: "相同幂等键已提交，未创建重复订单。"
    };
  }

  state.idempotencyKeys.add(idempotencyKey);

  const baseOrder = {
    id: `ORD-${String(state.orders.length + 1).padStart(4, "0")}`,
    symbol,
    side,
    quantity,
    filledQty: 0,
    orderType,
    limitPrice,
    stopPrice,
    timeInForce,
    status: "NEW",
    createdAt: new Date().toISOString(),
    idempotencyKey,
    thesis
  };

  const rejection = validateOrder(state, baseOrder, instrument);
  if (rejection) {
    baseOrder.status = "REJECTED";
    baseOrder.rejectReason = rejection;
    state.orders.unshift(baseOrder);
    state.auditLog.unshift(`${baseOrder.id} rejected: ${rejection}`);
    return { ok: false, code: "ORDER_REJECTED", message: rejection, order: baseOrder };
  }

  baseOrder.status = "ACCEPTED";
  const result = simulateExecution(state, baseOrder, instrument);
  state.orders.unshift(baseOrder);

  if (thesis) {
    state.theses.unshift({
      symbol,
      orderId: baseOrder.id,
      thesis,
      plan: input.plan || "Hold 5-10 trading days",
      stopLoss: input.stopLoss || "",
      target: input.target || "",
      tag: input.tag || "MVP"
    });
  }

  state.auditLog.unshift(`${baseOrder.id} ${baseOrder.status} via simulator v0.1`);
  return { ok: true, order: baseOrder, execution: result.execution };
}

// 下单前风控校验。第一阶段 demo 覆盖：证券是否存在、数量是否合法、
// 限价/止损价格是否合理、是否有足够现金、是否试图裸卖空。
function validateOrder(state, order, instrument) {
  if (!instrument) return "Unknown or unsupported US stock / ETF symbol.";
  if (!Number.isFinite(order.quantity) || order.quantity <= 0 || !Number.isInteger(order.quantity)) {
    return "Quantity must be a positive whole number.";
  }
  if (order.orderType === "LIMIT" && (!Number.isFinite(order.limitPrice) || order.limitPrice <= 0)) {
    return "Limit order requires a positive limit price.";
  }
  if (order.orderType === "STOP" && (!Number.isFinite(order.stopPrice) || order.stopPrice <= 0)) {
    return "Stop order requires a positive stop price.";
  }
  if (order.side === "SELL") {
    const heldQty = state.positions[order.symbol]?.qty || 0;
    if (heldQty < order.quantity) return "Naked short selling is disabled in phase one.";
  }
  if (order.side === "BUY") {
    const estimatedCost = order.quantity * instrument.price * 1.0025;
    if (estimatedCost > state.cash) return "Insufficient buying power.";
  }
  return "";
}

// 成交模拟器：根据订单类型和当前 quote 决定是否成交。
// 大单会部分成交；成交价加入固定滑点；每笔成交记录模型版本和 seed。
function simulateExecution(state, order, instrument) {
  const marketPrice = instrument.price;
  const limitBlocksBuy = order.orderType === "LIMIT" && order.side === "BUY" && order.limitPrice < marketPrice;
  const limitBlocksSell = order.orderType === "LIMIT" && order.side === "SELL" && order.limitPrice > marketPrice;
  const stopNotTriggeredBuy = order.orderType === "STOP" && order.side === "BUY" && order.stopPrice > marketPrice;
  const stopNotTriggeredSell = order.orderType === "STOP" && order.side === "SELL" && order.stopPrice < marketPrice;

  if (limitBlocksBuy || limitBlocksSell || stopNotTriggeredBuy || stopNotTriggeredSell) {
    order.status = "ACCEPTED";
    return { execution: null };
  }

  const fillRatio = order.quantity >= 75 ? 0.6 : 1;
  const filledQty = Math.max(1, Math.floor(order.quantity * fillRatio));
  const slippage = order.side === "BUY" ? 0.0015 : -0.0015;
  const fillPrice = round(marketPrice * (1 + slippage), 2);
  const commission = round(Math.max(0.35, filledQty * 0.005), 2);
  const regulatoryFee = order.side === "SELL" ? round(filledQty * 0.000166, 2) : 0;

  order.filledQty = filledQty;
  order.status = filledQty === order.quantity ? "FILLED" : "PARTIALLY_FILLED";

  applyFill(state, order, filledQty, fillPrice, commission + regulatoryFee);

  const execution = {
    id: `EXE-${String(state.executions.length + 1).padStart(4, "0")}`,
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    quantity: filledQty,
    price: fillPrice,
    fees: round(commission + regulatoryFee, 2),
    quotePrice: marketPrice,
    modelVersion: "demo-sim-v0.1",
    seed: "fixed-demo-seed",
    latencyMs: 350,
    createdAt: new Date().toISOString()
  };

  state.executions.unshift(execution);
  return { execution };
}

// 把成交结果写回账户：买入扣现金并更新平均成本，卖出加现金并确认已实现盈亏。
function applyFill(state, order, quantity, price, fees) {
  const position = state.positions[order.symbol] || {
    symbol: order.symbol,
    qty: 0,
    avgCost: 0,
    realizedPnl: 0
  };

  if (order.side === "BUY") {
    const cost = quantity * price + fees;
    const totalCost = position.avgCost * position.qty + cost;
    position.qty += quantity;
    position.avgCost = round(totalCost / position.qty, 2);
    state.cash = round(state.cash - cost, 2);
  } else {
    const proceeds = quantity * price - fees;
    position.qty -= quantity;
    position.realizedPnl = round(position.realizedPnl + (price - position.avgCost) * quantity - fees, 2);
    state.cash = round(state.cash + proceeds, 2);
  }

  state.positions[order.symbol] = position;
}

// 只允许取消仍有未成交部分的订单；已完全成交或已拒绝订单不能撤销。
export function cancelOrder(state, orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return false;
  if (!["NEW", "ACCEPTED", "PARTIALLY_FILLED"].includes(order.status)) return false;
  if (order.status === "PARTIALLY_FILLED" && order.filledQty >= order.quantity) return false;
  order.status = "CANCELED";
  state.auditLog.unshift(`${order.id} canceled by user`);
  return true;
}

export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
