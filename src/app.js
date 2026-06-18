import {
  calculatePortfolio,
  cancelOrder,
  createInitialState,
  demoBars,
  getInstrument,
  instruments,
  marketValue,
  submitOrder
} from "./simulator.js";

const state = createInitialState();
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// 页面上会频繁读写这些 DOM 节点，集中保存可以避免在每个函数里重复查询。
const elements = {
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

let selectedSymbol = "AAPL";

// 总渲染函数：任何状态变化后都重新画一遍页面，适合这个轻量 demo。
// 真实大型应用通常会用 React/Vue 等框架自动管理这些局部更新。
function render() {
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

function renderInstruments() {
  const query = elements.symbolSearch.value.trim().toLowerCase();
  // 根据搜索框内容过滤证券列表，然后把结果拼成表格行。
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
  const min = Math.min(...demoBars);
  const max = Math.max(...demoBars);
  // 把价格数组转换成 SVG 折线坐标。x 是时间位置，y 是归一化后的价格高度。
  const points = demoBars
    .map((value, index) => {
      const x = (index / (demoBars.length - 1)) * 100;
      const y = 94 - ((value - min) / (max - min)) * 82;
      return `${x},${y}`;
    })
    .join(" ");

  elements.chart.innerHTML = `
    <div class="chart-head">
      <div>
        <strong>${selectedSymbol} demo price path</strong>
        <span>1D view · data source: ${instrument.source}</span>
      </div>
      <span>Last updated ${instrument.updatedAt}</span>
    </div>
    <svg viewBox="0 0 100 100" role="img" aria-label="${selectedSymbol} chart">
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
  `;
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
    <p class="data-note">${instrument.source}. Demo quotes are delayed and are not investment advice.</p>
  `;

  elements.orderForm.symbol.value = selectedSymbol;
}

function renderPortfolio() {
  const portfolio = calculatePortfolio(state);
  // 组合指标都来自 simulator 的计算结果，页面只负责展示，不直接改账户数据。
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

elements.symbolSearch.addEventListener("input", renderInstruments);

// 事件委托：列表里的行和按钮是动态生成的，所以把点击监听挂在 document 上。
document.addEventListener("click", (event) => {
  const symbolButton = event.target.closest("[data-symbol]");
  const cancelButton = event.target.closest("[data-cancel]");

  if (symbolButton) {
    selectedSymbol = symbolButton.dataset.symbol;
    render();
  }

  if (cancelButton) {
    cancelOrder(state, cancelButton.dataset.cancel);
    render();
  }
});

elements.orderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  // FormData 会读取表单里所有 name 字段，再交给 submitOrder 做业务校验和成交模拟。
  const form = new FormData(elements.orderForm);
  const result = submitOrder(state, Object.fromEntries(form.entries()));
  elements.orderMessage.textContent = result.ok ? `${result.order.id} submitted: ${result.order.status}` : result.message;
  elements.orderMessage.className = result.ok ? "message success" : "message error";
  render();
});

elements.csvExport.addEventListener("click", () => {
  // 浏览器端直接生成 CSV 下载，便于 demo 交易历史导出。
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
  link.download = "paper-trading-orders.csv";
  link.click();
  URL.revokeObjectURL(url);
});

render();
