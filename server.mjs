import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cancelOrder,
  createInitialState,
  hydrateState,
  serializeState,
  submitOrder
} from "./src/simulator.js";

const defaultPort = Number(process.env.PORT || 4173);
const defaultRoot = process.cwd();
const defaultDbFile = process.env.STOCK_SIM_DB || join(defaultRoot, "data", "stock-sim-db.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export function createStockSimServer({ root = defaultRoot, dbFile = defaultDbFile } = {}) {
  const database = createJsonDatabase(dbFile);

  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url, database);
        return;
      }

      await serveStaticFile(response, root, url.pathname);
    } catch (error) {
      sendJson(response, 500, { error: "SERVER_ERROR", message: error.message });
    }
  });
}

async function handleApi(request, response, url, database) {
  if (request.method === "POST" && url.pathname === "/api/users") {
    const input = await readJsonBody(request);
    const result = await database.createUser(input.username, input.password);
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error, message: result.message });
      return;
    }

    sendJson(response, 201, {
      user: publicUser(result.user),
      tradingState: result.user.tradingState
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const input = await readJsonBody(request);
    const result = await database.login(input.username, input.password);
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error, message: result.message });
      return;
    }

    sendJson(response, 200, {
      user: publicUser(result.user),
      tradingState: result.user.tradingState
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/trading-state") {
    const user = await requireUser(request, database);
    if (!user.ok) {
      sendJson(response, user.status, { error: user.error, message: user.message });
      return;
    }

    sendJson(response, 200, { user: publicUser(user.value), tradingState: user.value.tradingState });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    const user = await requireUser(request, database);
    if (!user.ok) {
      sendJson(response, user.status, { error: user.error, message: user.message });
      return;
    }

    const input = await readJsonBody(request);
    const state = hydrateState(user.value.tradingState);
    const result = submitOrder(state, input);
    await database.updateTradingState(user.value.id, serializeState(state));
    sendJson(response, result.ok ? 201 : 400, {
      result,
      tradingState: serializeState(state)
    });
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const user = await requireUser(request, database);
    if (!user.ok) {
      sendJson(response, user.status, { error: user.error, message: user.message });
      return;
    }

    const state = hydrateState(user.value.tradingState);
    const canceled = cancelOrder(state, decodeURIComponent(cancelMatch[1]));
    await database.updateTradingState(user.value.id, serializeState(state));
    sendJson(response, canceled ? 200 : 400, {
      ok: canceled,
      tradingState: serializeState(state)
    });
    return;
  }

  sendJson(response, 404, { error: "NOT_FOUND", message: "API route not found." });
}

function createJsonDatabase(dbFile) {
  async function readDb() {
    try {
      return JSON.parse(await readFile(dbFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { users: [] };
    }
  }

  async function writeDb(db) {
    await mkdir(dirname(dbFile), { recursive: true });
    await writeFile(dbFile, JSON.stringify(db, null, 2));
  }

  return {
    async createUser(usernameInput, passwordInput) {
      const username = normalizeUsername(usernameInput);
      const password = String(passwordInput || "");
      if (!username || password.length < 6) {
        return {
          ok: false,
          status: 400,
          error: "INVALID_SIGNUP",
          message: "Username is required and password must be at least 6 characters."
        };
      }

      const db = await readDb();
      if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
        return {
          ok: false,
          status: 409,
          error: "USER_EXISTS",
          message: "That username already exists."
        };
      }

      const user = {
        id: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
        tradingState: serializeState(createInitialState())
      };

      user.tradingState.auditLog.unshift(`User ${username} created`);
      db.users.push(user);
      await writeDb(db);
      return { ok: true, user };
    },

    async login(usernameInput, passwordInput) {
      const username = normalizeUsername(usernameInput);
      const db = await readDb();
      const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
      if (!user || user.passwordHash !== hashPassword(String(passwordInput || ""))) {
        return {
          ok: false,
          status: 401,
          error: "INVALID_LOGIN",
          message: "Invalid username or password."
        };
      }

      return { ok: true, user };
    },

    async findUser(userId) {
      const db = await readDb();
      return db.users.find((user) => user.id === userId) || null;
    },

    async updateTradingState(userId, tradingState) {
      const db = await readDb();
      const user = db.users.find((item) => item.id === userId);
      if (!user) return false;
      user.tradingState = tradingState;
      await writeDb(db);
      return true;
    }
  };
}

async function serveStaticFile(response, root, pathname) {
  const rawPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  let body;

  try {
    body = await readFile(filePath);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function requireUser(request, database) {
  const userId = request.headers["x-user-id"];
  if (!userId) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED", message: "Login required." };
  }

  const user = await database.findUser(String(userId));
  if (!user) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED", message: "Login required." };
  }

  return { ok: true, value: user };
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  createStockSimServer().listen(defaultPort, () => {
    console.log(`Stock Sim AI demo running at http://localhost:${defaultPort}`);
  });
}
