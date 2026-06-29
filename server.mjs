import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cancelOrder,
  applyInstrumentQuote,
  createInitialState,
  hydrateState,
  serializeState,
  submitOrder
} from "./src/simulator.js";
import {
  getAlpacaLimiterState,
  getHistoricalBars,
  getLatestQuote,
  listInstruments
} from "./src/market-data.js";

const defaultPort = Number(process.env.PORT || 4173);
const defaultRoot = process.cwd();
const defaultDbFile = process.env.STOCK_SIM_DB || join(defaultRoot, "data", "stock-sim-db.json");
const sessionCookieName = "stock_sim_session";
const defaultSessionTtlMs = 1000 * 60 * 60 * 8;
const sessionSecret = process.env.STOCK_SIM_SESSION_SECRET || randomBytes(32).toString("hex");
const passwordIterations = 310000;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export function createStockSimServer({
  root = defaultRoot,
  dbFile = defaultDbFile,
  sessionTtlMs = defaultSessionTtlMs
} = {}) {
  const database = createJsonDatabase(dbFile);

  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url, database, sessionTtlMs);
        return;
      }

      await serveStaticFile(response, root, url.pathname);
    } catch (error) {
      sendJson(response, 500, { error: "SERVER_ERROR", message: error.message });
    }
  });
}

async function handleApi(request, response, url, database, sessionTtlMs) {
  if (request.method === "POST" && url.pathname === "/api/users") {
    const input = await readJsonBody(request);
    const result = await database.createUser(input.username, input.password);
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error, message: result.message });
      return;
    }

    const session = await database.createSession(result.user.id, sessionTtlMs);
    sendJson(response, 201, {
      user: publicUser(result.user),
      tradingState: result.user.tradingState
    }, { "Set-Cookie": buildSessionCookie(session.token, session.expiresAt, sessionTtlMs) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const input = await readJsonBody(request);
    const result = await database.login(input.username, input.password);
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error, message: result.message });
      return;
    }

    const session = await database.createSession(result.user.id, sessionTtlMs);
    sendJson(response, 200, {
      user: publicUser(result.user),
      tradingState: result.user.tradingState
    }, { "Set-Cookie": buildSessionCookie(session.token, session.expiresAt, sessionTtlMs) });
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/sessions") {
    const session = await requireSession(request, database);
    if (session.ok) {
      await database.deleteSession(session.sessionIdHash);
    }

    sendJson(response, 200, { ok: true }, { "Set-Cookie": expireSessionCookie() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/market-data/instruments") {
    sendJson(response, 200, { instruments: listInstruments() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/market-data/quote") {
    const result = await getLatestQuote(url.searchParams.get("symbol"));
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error, message: result.message });
      return;
    }

    applyInstrumentQuote(result.quote);
    sendJson(response, 200, { quote: result.quote, alpacaLimiter: getAlpacaLimiterState() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/market-data/bars") {
    const includeExtendedHours = ["1", "true", "yes"].includes(String(url.searchParams.get("extendedHours") || "").toLowerCase());
    const result = await getHistoricalBars(url.searchParams.get("symbol"), url.searchParams.get("timeframe"), includeExtendedHours);
    if (!result.ok) {
      sendJson(response, result.status, { error: result.error, message: result.message });
      return;
    }

    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/market-data/status") {
    sendJson(response, 200, {
      alpaca: getAlpacaLimiterState(),
      historicalProvider: "yfinance python scraper with demo fallback"
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
    const quote = await getLatestQuote(input.symbol);
    if (quote.ok) applyInstrumentQuote(quote.quote);
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
      const db = JSON.parse(await readFile(dbFile, "utf8"));
      return { users: db.users || [], sessions: db.sessions || [] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { users: [], sessions: [] };
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
      const passwordError = validatePassword(password);
      if (!username || passwordError) {
        return {
          ok: false,
          status: 400,
          error: "INVALID_SIGNUP",
          message: !username ? "Username is required." : passwordError
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
      const passwordResult = user ? verifyPassword(String(passwordInput || ""), user.passwordHash) : { ok: false };
      if (!user || !passwordResult.ok) {
        return {
          ok: false,
          status: 401,
          error: "INVALID_LOGIN",
          message: "Invalid username or password."
        };
      }

      if (passwordResult.needsUpgrade) {
        user.passwordHash = hashPassword(String(passwordInput || ""));
        await writeDb(db);
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
    },

    async createSession(userId, ttlMs) {
      const db = await readDb();
      const now = Date.now();
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now + ttlMs).toISOString();
      db.sessions = (db.sessions || []).filter((session) => Date.parse(session.expiresAt) > now);
      db.sessions.push({
        idHash: hashSessionId(token),
        userId,
        createdAt: new Date(now).toISOString(),
        expiresAt
      });
      await writeDb(db);
      return { token, expiresAt };
    },

    async findSession(sessionIdHash) {
      const db = await readDb();
      const now = Date.now();
      const session = (db.sessions || []).find((item) => item.idHash === sessionIdHash);
      if (!session) return null;
      if (Date.parse(session.expiresAt) <= now) {
        db.sessions = db.sessions.filter((item) => item.idHash !== sessionIdHash);
        await writeDb(db);
        return null;
      }
      const user = db.users.find((item) => item.id === session.userId);
      return user ? { session, user } : null;
    },

    async deleteSession(sessionIdHash) {
      const db = await readDb();
      db.sessions = (db.sessions || []).filter((session) => session.idHash !== sessionIdHash);
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
  const session = await requireSession(request, database);
  if (!session.ok) {
    return session;
  }

  return { ok: true, value: session.value };
}

async function requireSession(request, database) {
  const parsed = parseSessionCookie(request);
  if (!parsed) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED", message: "Login required." };
  }

  const sessionIdHash = hashSessionId(parsed.sessionId);
  const result = await database.findSession(sessionIdHash);
  if (!result) {
    return { ok: false, status: 401, error: "AUTH_REQUIRED", message: "Login required." };
  }

  return { ok: true, sessionIdHash, value: result.user };
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, passwordIterations, 32, "sha256").toString("base64url");
  return `pbkdf2$sha256$${passwordIterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash = "") {
  const parts = storedHash.split("$");
  if (parts.length === 5 && parts[0] === "pbkdf2" && parts[1] === "sha256") {
    const [, , iterationText, salt, expectedHash] = parts;
    const iterations = Number(iterationText);
    if (!Number.isSafeInteger(iterations) || iterations <= 0) return { ok: false };
    const actualHash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
    return { ok: constantTimeEqual(actualHash, expectedHash) };
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const legacyHash = createHash("sha256").update(password).digest("hex");
    return { ok: constantTimeEqual(legacyHash, storedHash), needsUpgrade: true };
  }

  return { ok: false };
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function hashSessionId(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex");
}

function signSession(sessionId, expiresAtMs) {
  return createHmac("sha256", sessionSecret).update(`${sessionId}.${expiresAtMs}`).digest("base64url");
}

function buildSessionCookie(sessionId, expiresAt, ttlMs) {
  const expiresAtMs = Date.parse(expiresAt);
  const signedValue = `${sessionId}.${expiresAtMs}.${signSession(sessionId, expiresAtMs)}`;
  const maxAge = Math.max(0, Math.floor(ttlMs / 1000));
  return `${sessionCookieName}=${signedValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function expireSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseSessionCookie(request) {
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookieName}=`));
  if (!cookie) return null;

  const value = cookie.slice(sessionCookieName.length + 1);
  const [sessionId, expiresAtText, signature] = value.split(".");
  if (!sessionId || !expiresAtText || !signature) return null;

  const expiresAtMs = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  if (!constantTimeEqual(signature, signSession(sessionId, expiresAtMs))) return null;

  return { sessionId, expiresAt: new Date(expiresAtMs).toISOString() };
}

function validatePassword(password) {
  if (password.length < 8 || password.length > 20) {
    return "Password must be 8-20 characters.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }

  return "";
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

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  createStockSimServer().listen(defaultPort, () => {
    console.log(`Stock Sim AI demo running at http://localhost:${defaultPort}`);
  });
}
