const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAdminPanel, SESSION_COOKIE } = require("../admin-panel");

const silentLog = { error() {}, warn() {}, info() {} };
const PASSWORD = "zed-password-123456789";

function fakeEngine() {
  const toggles = [];
  return {
    toggles,
    statuses: () => [
      {
        id: "1", name: "أ", enabled: true, status: "online", loggedIn: true,
        listenerActive: true, lastError: null, lastConnectedAt: null,
        lastEventAt: Date.now(), messagesSeen: 7, reconnectAttempts: 0,
      },
    ],
    statusOf: () => null,
    startAccount: async () => ({ ok: true }),
    stopAccount: (id) => { toggles.push(["stop", id]); return { ok: true }; },
    removeAccount: () => ({ ok: true }),
    startAll: async () => {},
    stopAll: () => {},
  };
}

function fakeStore() {
  return {
    list: () => [
      { id: "1", name: "أ", enabled: true, createdAt: "", cookiesCount: 2, hasCUser: true, hasXs: true },
    ],
    add: () => ({ ok: true, id: "2" }),
    update: (id, patch) => ({ ok: true }),
    remove: (id) => ({ ok: id === "1" }),
    setEnabled: () => ({ ok: true }),
    get: (id) => ({ id, name: "أ" }),
    decrypt: () => [],
  };
}

async function startPanel(overrides = {}) {
  const panel = createAdminPanel({
    password: overrides.password === undefined ? PASSWORD : overrides.password,
    engine: overrides.engine || fakeEngine(),
    store: overrides.store || fakeStore(),
    log: silentLog,
  });
  const port = await panel.listen(0);
  return { base: `http://127.0.0.1:${port}`, panel };
}

async function login(base, password = PASSWORD) {
  const res = await fetch(`${base}/admin/cookies/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  return { res, token: match ? match[1] : null };
}

function authed(token, method = "GET", body) {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

test("panel page is served at /admin/cookies without auth and carries the brand", async () => {
  const { base, panel } = await startPanel();
  try {
    const res = await fetch(`${base}/admin/cookies`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /ZEDHELLKING/);
    assert.match(html, /admin\/cookies\/api\/accounts/);
    assert.doesNotMatch(html, /c_user=|appstate\.json/);
  } finally {
    await panel.close();
  }
});

test("login sets an HttpOnly session cookie and wrong password is rejected", async () => {
  const { base, panel } = await startPanel();
  try {
    const bad = await login(base, "totally-wrong-password");
    assert.equal(bad.res.status, 401);
    assert.equal(bad.token, null);

    const good = await login(base);
    assert.equal(good.res.status, 200);
    assert.ok(good.token);
    const cookieHeader = good.res.headers.get("set-cookie") || "";
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Lax/);
  } finally {
    await panel.close();
  }
});

test("account routes require a valid session and never leak cookies", async () => {
  const { base, panel } = await startPanel();
  try {
    assert.equal((await fetch(`${base}/admin/cookies/api/accounts`)).status, 401);

    const { token } = await login(base);
    const res = await fetch(`${base}/admin/cookies/api/accounts`, authed(token));
    assert.equal(res.status, 200);
    const body = await res.text();
    const parsed = JSON.parse(body);
    assert.equal(parsed.accounts.length, 1);
    assert.equal(parsed.accounts[0].cookiesCount, 2);
    assert.doesNotMatch(body, /"value"|c_user|appState|cookies:/);
  } finally {
    await panel.close();
  }
});

test("toggle calls engine stop and start per account, independently", async () => {
  const engine = fakeEngine();
  const { base, panel } = await startPanel({ engine });
  try {
    const { token } = await login(base);
    const off = await fetch(`${base}/admin/cookies/api/accounts/1/toggle`, authed(token, "POST", { enabled: false }));
    assert.equal(off.status, 200);
    const on = await fetch(`${base}/admin/cookies/api/accounts/1/toggle`, authed(token, "POST", { enabled: true }));
    assert.equal(on.status, 200);
    assert.deepEqual(engine.toggles, [["stop", "1"]]);
  } finally {
    await panel.close();
  }
});

test("delete removes the account and returns 404 for unknown routes", async () => {
  const { base, panel } = await startPanel();
  try {
    const { token } = await login(base);
    const del = await fetch(`${base}/admin/cookies/api/accounts/1`, authed(token, "DELETE"));
    assert.equal(del.status, 200);
    const missing = await fetch(`${base}/admin/cookies/api/accounts/99`, authed(token, "DELETE"));
    assert.equal(missing.status, 400);
    const nf = await fetch(`${base}/admin/cookies/api/nonsense`, authed(token));
    assert.equal(nf.status, 404);
  } finally {
    await panel.close();
  }
});

test("sessions expire after logout", async () => {
  const { base, panel } = await startPanel();
  try {
    const { token } = await login(base);
    await fetch(`${base}/admin/cookies/api/logout`, { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${token}` } });
    const after = await fetch(`${base}/admin/cookies/api/accounts`, authed(token));
    assert.equal(after.status, 401);
  } finally {
    await panel.close();
  }
});
