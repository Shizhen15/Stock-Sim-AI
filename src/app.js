import {
  calculatePortfolio,
  getInstrument,
  instruments,
  marketValue
} from "./simulator.js";

let state = null;
let selectedSymbol = "AAPL";
let authMode = "login";
let currentUser = null;
let selectedTimeframe = "1D";
let marketBars = [];
let marketSource = null;
let chartRequestId = 0;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const elements = {
  authScreen: document.querySelector("#authScreen"),
  loginTab: document.querySelector("#loginTab"),
  signupTab: document.querySelector("#signupTab"),
  authForm: document.querySelector("#authForm"),
  authSubmit: document.querySelector("#authSubmit"),
  authMessage: document.querySelector("#authMessage"),
  passwordInput: document.querySelector("input[name='password']"),
  passwordHint: document.querySelector("#passwordHint"),
  currentUser: document.querySelector("#currentUser"),
  logoutButton: document.querySelector("#logoutButton"),
  symbolSearch: document.querySelector("#symbolSearch"),
  instrumentTable: document.querySelector("#instrumentTable"),
  watchlists: document.querySelector("#watchlists"),
  chart: document.querySelector("#chart"),
  quoteCard: document.querySelector("#quoteCard"),
  orderForm: document.querySelector("#orderForm"),
  orderMessage: document.querySelector("#orderMessage"),
  portfolioStats: document.querySelector("#portfolioStats"),
  positions: document.querySelector("#positions"),
  orders: document.querySelector("#orders"),
  executions: document.querySelector("#executions"),
  theses: document.querySelector("#theses"),
  alerts: document.querySelector("#alerts"),
  auditLog: document.querySelector("#auditLog"),
  csvExport: document.querySelector("#csvExport")
};

function render() {
  renderAuthState();
  if (!state) return;
  renderInstruments();
  renderWatchlists();
  renderChart();
  renderQuoteCard();
  renderPortfolio();
  renderOrders();
  renderExecutions();
  renderTheses();
  renderAlerts();
  renderAuditLog();
}

function renderAuthState() {
  elements.authScreen.hidden = Boolean(currentUser && state);
  elements.currentUser.textContent = currentUser ? `用户：${currentUser.username}` : "未登录";
  elements.loginTab.classList.toggle("active", authMode === "login");
  elements.signupTab.classList.toggle("active", authMode === "signup");
  elements.loginTab.setAttribute("aria-selected", String(authMode === "login"));
  elements.signupTab.setAttribute("aria-selected", String(authMode === "signup"));
  if (authMode === "signup") {
    elements.passwordInput.autocomplete = "new-password";
    elements.passwordInput.setAttribute("minlength", "8");
    elements.passwordInput.setAttribute("maxlength", "20");
    elements.passwordInput.setAttribute("pattern", "^(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,20}$");
    elements.passwordInput.title = "密码需为 8-20 个字符，并包含至少一个大写字母、一个数字和一个特殊符号。";
  } else {
    elements.passwordInput.autocomplete = "current-password";
    elements.passwordInput.removeAttribute("minlength");
    elements.passwordInput.removeAttribute("maxlength");
    elements.passwordInput.removeAttribute("pattern");
    elements.passwordInput.removeAttribute("title");
  }
  elements.passwordHint.hidden = authMode !== "signup";
  elements.authSubmit.textContent = authMode === "login" ? "登录用户" : "创建新用户";
}

function renderInstruments() {
  const query = elements.symbolSearch.value.trim().toLowerCase();
  const rows = instruments
    .filter((item) => `${item.symbol} ${item.name} ${item.sector}`.toLowerCase().includes(query))
    .map((item) => `
      <tr class="${item.symbol === selectedSymbol ? "selected" : ""}" data-symbol="${item.symbol}">
        <td><strong>${item.symbol}</strong><span>${item.name}</span></td>
        <td>${money.format(item.price)}</td>
        <td class="${item.changePct >= 0 ? "positive" : "negative"}">${item.changePct.toFixed(2)}%</td>
        <td>${item.volume}</td>
        <td>${item.marketCap}</td>
        <td>${item.sector}</td>
      </tr>
    `)
    .join("");

  elements.instrumentTable.innerHTML = rows;
}

function renderWatchlists() {
  elements.watchlists.innerHTML = Object.entries(state.watchlists)
    .map(([name, symbols]) => `
      <section class="watchlist">
        <div class="list-head">
          <strong>${name}</strong>
          <span>${symbols.length} symbols</span>
        </div>
        <div class="chips">
          ${symbols.map((symbol) => `<button type="button" data-symbol="${symbol}">${symbol}</button>`).join("")}
        </div>
      </section>
    `)
    .join("");
}

function renderChart() {
  const instrument = getInstrument(selectedSymbol);
  const bars = marketBars.length ? marketBars : buildFallbackBars(instrument);
  const closes = bars.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const points = bars
    .map((bar, index) => {
      const x = (index / (bars.length - 1)) * 100;
      const y = 94 - ((bar.close - min) / (max - min || 1)) * 82;
      return `${x},${y}`;
    })
    .join(" ");

  elements.chart.innerHTML = `
    <div class="chart-head">
      <div>
        <strong>${selectedSymbol} price chart</strong>
        <span>${selectedTimeframe} view · ${marketSource?.source || instrument.source}</span>
      </div>
      <div class="timeframe-tabs" role="tablist" aria-label="Chart timeframe">
        ${["15m", "1H", "1D"].map((timeframe) => `
          <button type="button" class="${timeframe === selectedTimeframe ? "active" : ""}" data-timeframe="${timeframe}">${timeframe}</button>
        `).join("")}
      </div>
    </div>
    <div id="tradingViewChart" class="chart-canvas"></div>
    <svg class="fallback-chart" viewBox="0 0 100 100" role="img" aria-label="${selectedSymbol} chart">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#1f8f70" stop-opacity="0.24"></stop>
          <stop offset="100%" stop-color="#1f8f70" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <polyline class="grid" points="0,20 100,20"></polyline>
      <polyline class="grid" points="0,50 100,50"></polyline>
      <polyline class="grid" points="0,80 100,80"></polyline>
      <polygon class="area" points="0,100 ${points} 100,100"></polygon>
      <polyline class="line" points="${points}"></polyline>
    </svg>
    <p class="data-note">${marketSource?.source || instrument.source}. Last updated ${formatMarketTime(marketSource?.lastUpdated || instrument.updatedAt)}.</p>
  `;

  renderTradingViewChart(bars);
  if (marketSource?.symbol !== selectedSymbol || marketSource?.timeframe !== selectedTimeframe) {
    void loadBars(selectedSymbol, selectedTimeframe);
  }
}

function renderQuoteCard() {
  const instrument = getInstrument(selectedSymbol);
  elements.quoteCard.innerHTML = `
    <div>
      <span class="eyebrow">Selected security</span>
      <h2>${instrument.symbol}</h2>
      <p>${instrument.name}</p>
    </div>
    <dl>
      <div><dt>Latest price</dt><dd>${money.format(instrument.price)}</dd></div>
      <div><dt>Change</dt><dd class="${instrument.changePct >= 0 ? "positive" : "negative"}">${instrument.changePct.toFixed(2)}%</dd></div>
      <div><dt>Volume</dt><dd>${instrument.volume}</dd></div>
      <div><dt>Market cap</dt><dd>${instrument.marketCap}</dd></div>
      <div><dt>P/E</dt><dd>${instrument.pe}</dd></div>
      <div><dt>Status</dt><dd>Regular session</dd></div>
    </dl>
    <p class="data-note">${instrument.source}. Last updated ${formatMarketTime(instrument.updatedAt)}. Demo quotes are delayed unless Alpaca is configured; this is not investment advice.</p>
  `;

  elements.orderForm.symbol.value = selectedSymbol;
}

function renderPortfolio() {
  const portfolio = calculatePortfolio(state);
  elements.portfolioStats.innerHTML = `
    ${stat("Net equity", money.format(portfolio.equity), portfolio.cumulativeReturnPct)}
    ${stat("Cash", money.format(portfolio.cash))}
    ${stat("Buying power", money.format(portfolio.buyingPower))}
    ${stat("Unrealized P/L", money.format(portfolio.unrealizedPnl), portfolio.unrealizedPnl)}
    ${stat("Max drawdown", `${portfolio.maxDrawdownPct.toFixed(1)}%`, portfolio.maxDrawdownPct)}
    ${stat("Win rate", `${portfolio.winRatePct}%`)}
  `;

  elements.positions.innerHTML = portfolio.positions
    .map((position) => {
      const instrument = getInstrument(position.symbol);
      const pnl = (instrument.price - position.avgCost) * position.qty;
      return `
        <tr>
          <td><strong>${position.symbol}</strong></td>
          <td>${position.qty}</td>
          <td>${money.format(position.avgCost)}</td>
          <td>${money.format(instrument.price)}</td>
          <td>${money.format(marketValue(position))}</td>
          <td class="${pnl >= 0 ? "positive" : "negative"}">${money.format(pnl)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderOrders() {
  elements.orders.innerHTML = state.orders.length
    ? state.orders.map((order) => `
      <tr>
        <td><strong>${order.id}</strong><span>${order.symbol}</span></td>
        <td>${order.side}</td>
        <td>${order.orderType}</td>
        <td>${order.filledQty}/${order.quantity}</td>
        <td><span class="status ${order.status.toLowerCase()}">${order.status}</span></td>
        <td>${order.rejectReason || order.timeInForce}</td>
        <td>
          ${["ACCEPTED", "PARTIALLY_FILLED"].includes(order.status)
            ? `<button class="icon-button" type="button" title="Cancel order" data-cancel="${order.id}">×</button>`
            : ""}
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="7" class="empty">No orders yet</td></tr>`;
}

function renderExecutions() {
  elements.executions.innerHTML = state.executions.length
    ? state.executions.map((execution) => `
      <tr>
        <td><strong>${execution.id}</strong><span>${execution.orderId}</span></td>
        <td>${execution.symbol}</td>
        <td>${execution.side}</td>
        <td>${execution.quantity}</td>
        <td>${money.format(execution.price)}</td>
        <td>${money.format(execution.fees)}</td>
        <td>${execution.modelVersion}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7" class="empty">Executions will appear after a marketable order fills</td></tr>`;
}

function renderTheses() {
  elements.theses.innerHTML = state.theses.length
    ? state.theses.map((item) => `
      <article class="journal-entry">
        <div><strong>${item.symbol}</strong><span>${item.orderId} · ${item.tag}</span></div>
        <p>${item.thesis}</p>
        <footer>Plan: ${item.plan} · Stop: ${item.stopLoss || "n/a"} · Target: ${item.target || "n/a"}</footer>
      </article>
    `).join("")
    : `<p class="empty">Submit an order with a thesis to start the review log.</p>`;
}

function renderAlerts() {
  elements.alerts.innerHTML = state.alerts.map((alert) => `
    <li>
      <strong>${alert.symbol}</strong>
      <span>${alert.condition}</span>
      <em>${alert.status}</em>
    </li>
  `).join("");
}

function renderAuditLog() {
  elements.auditLog.innerHTML = state.auditLog.map((item) => `<li>${item}</li>`).join("");
}

function stat(label, value, delta) {
  const deltaClass = Number(delta) >= 0 ? "positive" : "negative";
  const deltaHtml = Number.isFinite(delta) ? `<span class="${deltaClass}">${delta > 0 ? "+" : ""}${delta.toFixed(2)}%</span>` : "";
  return `<article class="stat"><span>${label}</span><strong>${value}</strong>${deltaHtml}</article>`;
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/sessions") {
      clearSession("Your session expired. Please log in again.");
    }
    throw new Error(payload.message || "Request failed.");
  }
  return payload;
}

async function refreshInstruments() {
  const payload = await requestJson("/api/market-data/instruments");
  instruments.splice(0, instruments.length, ...payload.instruments);
}

async function refreshQuote(symbol) {
  const payload = await requestJson(`/api/market-data/quote?symbol=${encodeURIComponent(symbol)}`);
  syncInstrumentQuote(payload.quote);
  return payload.quote;
}

async function loadBars(symbol, timeframe) {
  const requestId = ++chartRequestId;
  try {
    const payload = await requestJson(`/api/market-data/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
    if (requestId !== chartRequestId || symbol !== selectedSymbol || timeframe !== selectedTimeframe) return;
    marketBars = payload.bars;
    marketSource = payload;
    renderChart();
  } catch {
    if (requestId === chartRequestId) {
      marketBars = [];
      marketSource = null;
    }
  }
}

function syncInstrumentQuote(quote) {
  const instrument = getInstrument(quote.symbol);
  if (!instrument) return;
  instrument.price = quote.price;
  instrument.changePct = quote.changePct;
  instrument.volume = quote.volume;
  instrument.marketCap = quote.marketCap;
  instrument.pe = quote.pe;
  instrument.source = quote.source;
  instrument.updatedAt = quote.eventTime || quote.receivedTime;
}

function buildFallbackBars(instrument) {
  const prices = [
    189, 194, 191, 198, 203, 201, 207, 211, 209, 214, 218, 215,
    221, 224, 219, 226, 232, 228, 235, 241, 238, 244, 249, 246
  ];
  return prices.map((value, index) => ({
    time: String(index),
    open: value,
    high: value * 1.006,
    low: value * 0.994,
    close: instrument.price * (value / prices.at(-1))
  }));
}

function renderTradingViewChart(bars) {
  const container = document.querySelector("#tradingViewChart");
  const fallback = elements.chart.querySelector(".fallback-chart");
  if (!container || !window.LightweightCharts?.createChart) {
    if (fallback) fallback.hidden = false;
    return;
  }

  fallback.hidden = true;
  const chart = window.LightweightCharts.createChart(container, {
    height: 250,
    layout: {
      background: { color: "#ffffff" },
      textColor: "#64706b"
    },
    grid: {
      vertLines: { color: "#eef3f0" },
      horzLines: { color: "#eef3f0" }
    },
    rightPriceScale: { borderColor: "#dce3df" },
    timeScale: {
      borderColor: "#dce3df",
      timeVisible: selectedTimeframe !== "1D"
    }
  });
  const series = chart.addCandlestickSeries({
    upColor: "#1f8f70",
    downColor: "#b73b4b",
    borderVisible: false,
    wickUpColor: "#1f8f70",
    wickDownColor: "#b73b4b"
  });
  series.setData(bars.map((bar) => ({
    time: toChartTime(bar.time),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close
  })));
  chart.timeScale().fitContent();
}

function toChartTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (selectedTimeframe === "1D") return date.toISOString().slice(0, 10);
  return Math.floor(date.getTime() / 1000);
}

function formatMarketTime(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setSession(user, tradingState) {
  currentUser = user;
  state = tradingState;
  elements.authMessage.textContent = "";
  elements.orderMessage.textContent = "";
  render();
}

function clearSession(message = "") {
  currentUser = null;
  state = null;
  authMode = "login";
  elements.authForm.reset();
  elements.authMessage.textContent = message;
  elements.authMessage.className = message ? "message error" : "message";
  render();
}

async function bootstrapSession() {
  try {
    await refreshInstruments();
    const payload = await requestJson("/api/trading-state");
    setSession(payload.user, payload.tradingState);
    await refreshQuote(selectedSymbol);
    await loadBars(selectedSymbol, selectedTimeframe);
  } catch {
    clearSession();
  }
}

elements.loginTab.addEventListener("click", () => {
  authMode = "login";
  elements.authMessage.textContent = "";
  renderAuthState();
});

elements.signupTab.addEventListener("click", () => {
  authMode = "signup";
  elements.authMessage.textContent = "";
  renderAuthState();
});

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.authForm);
  const path = authMode === "login" ? "/api/sessions" : "/api/users";
  const credentials = Object.fromEntries(form.entries());

  elements.authMessage.textContent = authMode === "login" ? "正在登录..." : "正在创建用户...";
  elements.authMessage.className = "message";
  elements.authSubmit.disabled = true;

  try {
    if (authMode === "signup") validateSignupPassword(String(credentials.password || ""));
    const payload = await requestJson(path, {
      method: "POST",
      body: JSON.stringify(credentials)
    });
    elements.authMessage.textContent = authMode === "login"
      ? `登录成功，欢迎 ${payload.user.username}。`
      : `用户 ${payload.user.username} 创建成功，正在进入工作台。`;
    elements.authMessage.className = "message success";
    await delay(500);
    setSession(payload.user, payload.tradingState);
    await refreshQuote(selectedSymbol);
    await loadBars(selectedSymbol, selectedTimeframe);
  } catch (error) {
    elements.authMessage.textContent = error.message;
    elements.authMessage.className = "message error";
  } finally {
    elements.authSubmit.disabled = false;
  }
});

function validateSignupPassword(password) {
  if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,20}$/.test(password)) {
    throw new Error("密码需为 8-20 个字符，并包含至少一个大写字母、一个数字和一个特殊符号。");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

elements.logoutButton.addEventListener("click", async () => {
  try {
    await requestJson("/api/sessions", { method: "DELETE", body: "{}" });
  } finally {
    clearSession();
  }
});
elements.symbolSearch.addEventListener("input", renderInstruments);

document.addEventListener("click", async (event) => {
  const symbolButton = event.target.closest("[data-symbol]");
  const cancelButton = event.target.closest("[data-cancel]");
  const timeframeButton = event.target.closest("[data-timeframe]");

  if (symbolButton) {
    selectedSymbol = symbolButton.dataset.symbol;
    marketBars = [];
    marketSource = null;
    await refreshQuote(selectedSymbol);
    render();
  }

  if (timeframeButton) {
    selectedTimeframe = timeframeButton.dataset.timeframe;
    marketBars = [];
    marketSource = null;
    renderChart();
  }

  if (cancelButton && currentUser) {
    const payload = await requestJson(`/api/orders/${encodeURIComponent(cancelButton.dataset.cancel)}/cancel`, {
      method: "POST",
      body: "{}"
    });
    state = payload.tradingState;
    render();
  }
});

elements.orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  const form = new FormData(elements.orderForm);
  try {
    const payload = await requestJson("/api/orders", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    state = payload.tradingState;
    elements.orderMessage.textContent = payload.result.ok
      ? `${payload.result.order.id} submitted: ${payload.result.order.status}`
      : payload.result.message;
    elements.orderMessage.className = payload.result.ok ? "message success" : "message error";
    render();
  } catch (error) {
    elements.orderMessage.textContent = error.message;
    elements.orderMessage.className = "message error";
  }
});

elements.csvExport.addEventListener("click", () => {
  if (!state) return;
  const header = "id,symbol,side,quantity,status,thesis";
  const lines = state.orders.map((order) => [
    order.id,
    order.symbol,
    order.side,
    order.quantity,
    order.status,
    JSON.stringify(order.thesis || "")
  ].join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentUser.username}-paper-trading-orders.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

window.addEventListener("load", () => {
  if (state) renderChart();
});

bootstrapSession();
