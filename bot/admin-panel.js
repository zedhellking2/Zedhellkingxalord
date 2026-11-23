const http = require("http");
const crypto = require("crypto");
const { readPanelPage } = require("./admin-panel-page");

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = "zed_panel_session";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function constantEquals(a, b) {
  const da = crypto.createHash("sha256").update(String(a)).digest();
  const db = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function createAdminPanel({ password, engine, store, log }) {
  const sessions = new Map();

  function newToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  function createSession() {
    const token = newToken();
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  function sessionValid(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return false;
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function destroySession(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) sessions.delete(token);
  }

  function sessionCookie(token, maxAgeSeconds) {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];
    return parts.join("; ");
  }

  function requireLogin(req, res) {
    if (sessionValid(req)) return true;
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }

  async function login(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
    if (!constantEquals(String(body.password || ""), password)) {
      log.warn("panel", "محاولة دخول فاشلة إلى لوحة الكوكيز");
      return sendJson(res, 401, { error: "wrong_password" });
    }
    const token = createSession();
    res.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
    return sendJson(res, 200, { ok: true });
  }

  function logout(req, res) {
    destroySession(req);
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    return sendJson(res, 200, { ok: true });
  }

  function me(req, res) {
    return sendJson(res, 200, { ok: true, brand: "ZEDHELLKING" });
  }

  function listAccounts(res) {
    const statuses = engine.statuses();
    const accounts = store.list().map((account) => {
      const live = statuses.find((s) => s.id === account.id) || null;
      return {
        id: account.id,
        name: account.name,
        enabled: account.enabled,
        createdAt: account.createdAt,
        cookiesCount: account.cookiesCount,
        hasCUser: account.hasCUser,
        hasXs: account.hasXs,
        status: live ? live.status : account.enabled ? "stopped" : "disabled",
        loggedIn: live ? live.loggedIn : false,
        listenerActive: live ? live.listenerActive : false,
        lastError: live ? live.lastError : null,
        lastConnectedAt: live ? live.lastConnectedAt : null,
        lastEventAt: live ? live.lastEventAt : null,
        messagesSeen: live ? live.messagesSeen : 0,
        reconnectAttempts: live ? live.reconnectAttempts : 0,
      };
    });
    return sendJson(res, 200, { accounts });
  }

  async function addAccount(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
    let state = body.cookies || body.appState || body.state;
    if (typeof state === "string") {
      try {
        state = JSON.parse(state);
      } catch {
        return sendJson(res, 400, { error: "invalid_state" });
      }
    }
    const result = store.add({ name: body.name, state });
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    if (body.start !== false) await engine.startAccount(result.id);
    log.info("panel", "تمت إضافة حساب جديد", { id: result.id });
    return sendJson(res, 200, { ok: true, id: result.id });
  }

  async function updateAccount(req, res, idText) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
    let state = body.cookies || body.appState || body.state;
    if (typeof state === "string") {
      try {
        state = JSON.parse(state);
      } catch {
        return sendJson(res, 400, { error: "invalid_state" });
      }
    }
    const result = store.update(idText, { name: body.name, state });
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    const entry = engine.statusOf(idText);
    if (state && entry) {
      engine.removeAccount(idText);
      await engine.startAccount(idText);
    }
    log.info("panel", "تم تعديل الحساب", { id: idText });
    return sendJson(res, 200, { ok: true });
  }

  async function toggleAccount(req, res, idText) {
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
    const enable = Boolean(body.enabled);
    const result = store.setEnabled(idText, enable);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    if (enable) await engine.startAccount(idText);
    else engine.stopAccount(idText);
    log.info("panel", enable ? "تم تشغيل الحساب" : "تم إيقاف الحساب", { id: idText });
    return sendJson(res, 200, { ok: true });
  }

  async function reconnectAccount(req, res, idText) {
    const record = store.get(idText);
    if (!record) return sendJson(res, 400, { error: "not_found" });
    engine.removeAccount(idText);
    const result = await engine.startAccount(idText);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    log.info("panel", "تمت إعادة اتصال الحساب", { id: idText });
    return sendJson(res, 200, { ok: true });
  }

  function removeAccount(req, res, idText) {
    engine.removeAccount(idText);
    const result = store.remove(idText);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    log.info("panel", "تم حذف الحساب", { id: idText });
    return sendJson(res, 200, { ok: true });
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method || "GET";

    if (method === "GET" && (pathname === "/admin/cookies" || pathname === "/admin/cookies/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(readPanelPage());
    }

    if (pathname === "/admin/cookies/api/login" && method === "POST") return login(req, res);

    if (pathname === "/admin/cookies/api/logout" && method === "POST") return logout(req, res);
    if (pathname === "/admin/cookies/api/me" && method === "GET") {
      if (!requireLogin(req, res)) return;
      return me(req, res);
    }

    if (pathname === "/admin/cookies/api/accounts" && method === "GET") {
      if (!requireLogin(req, res)) return;
      return listAccounts(res);
    }
    if (pathname === "/admin/cookies/api/accounts" && method === "POST") {
      if (!requireLogin(req, res)) return;
      return addAccount(req, res);
    }

    const idMatch = /^\/admin\/cookies\/api\/accounts\/(\d+)(\/toggle|\/reconnect)?$/.exec(pathname);
    if (idMatch) {
      const idText = idMatch[1];
      if (!requireLogin(req, res)) return;
      if (method === "PUT" || method === "PATCH") return updateAccount(req, res, idText);
      if (method === "DELETE") return removeAccount(req, res, idText);
      if (method === "POST" && url.pathname.endsWith("/toggle")) {
        return toggleAccount(req, res, idText);
      }
      if (method === "POST" && url.pathname.endsWith("/reconnect")) {
        return reconnectAccount(req, res, idText);
      }
    }

    return sendJson(res, 404, { error: "not_found" });
  }

  async function handle(req, res) {
    try {
      await route(req, res);
    } catch (error) {
      log.error("panel", "خطأ في لوحة الكوكيز", { message: error.message });
      if (!res.headersSent) {
        sendJson(res, error.message === "body_too_large" ? 413 : 500, { error: "request_failed" });
      }
    }
  }

  // Standalone server is retained for isolated tests.
  const server = http.createServer(handle);

  return {
    handle,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => {
          server.off("error", reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

module.exports = { createAdminPanel, SESSION_COOKIE };
