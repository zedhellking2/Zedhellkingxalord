const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccountsEngine } = require("../accounts-engine");

const silentLog = { error() {}, warn() {}, info() {} };

function fakeStore(records) {
  return {
    get: (id) => records.find((r) => r.id === id) || null,
    list: () => records.map(({ id, name, enabled }) => ({ id, name, enabled })),
    decrypt: (id) => (records.some((r) => r.id === id) ? [{ key: "c_user", value: id }] : null),
  };
}

function settle(ms = 40) {
  return new Promise((r) => setTimeout(r, ms));
}

test("two accounts run concurrently and stopping one leaves the other live", async () => {
  const logins = [];
  const listeners = new Map();
  const fakeLogin = (opts, loginOpts, cb) => {
    const id = opts.appState[0].value;
    logins.push(id);
    const api = {
      ctx: { lastSeqId: "1" },
      getAppState: () => opts.appState,
      logout: () => {},
      listenMqtt: async (onEvent) => {
        listeners.set(id, onEvent);
        return () => listeners.delete(id);
      },
    };
    setImmediate(() => cb(null, api));
  };

  const seen = [];
  const engine = createAccountsEngine({
    store: fakeStore([
      { id: "1", name: "أ", enabled: true },
      { id: "2", name: "ب", enabled: true },
    ]),
    onMessage: (account, event) => seen.push({ id: account.id, thread: event.threadID }),
    onEvent: () => {},
    log: silentLog,
    loginFn: fakeLogin,
  });

  await engine.startAll();
  await settle();

  let statuses = engine.statuses();
  assert.equal(statuses.length, 2);
  assert.equal(logins.slice().sort().join(","), "1,2");
  for (const s of statuses) {
    assert.equal(s.status, "online", `account ${s.id} should be online`);
    assert.equal(s.listenerActive, true);
  }

  listeners.get("1")(null, { type: "message", threadID: "t1", messageID: "m1" });
  listeners.get("2")(null, { type: "message", threadID: "t2", messageID: "m2" });
  await settle();
  assert.deepEqual(seen.sort((a, b) => a.id - b.id), [
    { id: "1", thread: "t1" },
    { id: "2", thread: "t2" },
  ]);

  assert.equal(engine.stopAccount("1").ok, true);
  statuses = engine.statuses();
  const first = statuses.find((s) => s.id === "1");
  const second = statuses.find((s) => s.id === "2");
  assert.equal(first.status, "stopped");
  assert.equal(first.listenerActive, false);
  assert.equal(second.status, "online");
  assert.equal(second.listenerActive, true);
});

test("startAll skips disabled accounts", async () => {
  const engine = createAccountsEngine({
    store: fakeStore([
      { id: "1", name: "معطل", enabled: false },
      { id: "2", name: "مفعل", enabled: true },
    ]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: (opts, o, cb) => cb(new Error("should not be called")),
  });
  await engine.startAll();
  await settle();
  const statuses = engine.statuses();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].id, "2");
});

test("checkpoint on login marks needs_attention without crash or reconnect storm", async () => {
  const fakeLogin = (opts, o, cb) => {
    const err = new Error("Checkpoint required");
    err.error = "login-approval";
    cb(err, null);
  };
  const engine = createAccountsEngine({
    store: fakeStore([{ id: "1", name: "أ", enabled: true }]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: fakeLogin,
  });
  await engine.startAll();
  await settle();
  const s = engine.statusOf("1");
  assert.ok(s);
  assert.equal(s.loggedIn, false);
  assert.equal(s.status, "needs_attention");
});

test("listener error on one account reconnects it without touching the other", async () => {
  let fireError = null;
  const fakeLogin = (opts, loginOpts, cb) => {
    const id = opts.appState[0].value;
    const api = {
      ctx: { lastSeqId: "1" },
      getAppState: () => opts.appState,
      logout: () => {},
      listenMqtt: async (onEvent) => {
        if (id === "1") fireError = () => onEvent(new Error("mqtt dropped"));
        return () => {};
      },
    };
    setImmediate(() => cb(null, api));
  };
  const engine = createAccountsEngine({
    store: fakeStore([
      { id: "1", name: "أ", enabled: true },
      { id: "2", name: "ب", enabled: true },
    ]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: fakeLogin,
  });
  await engine.startAll();
  await settle();

  fireError();
  await settle();

  const first = engine.statusOf("1");
  const second = engine.statusOf("2");
  assert.equal(first.status, "reconnecting");
  assert.equal(first.lastError, "transient");
  assert.ok(first.reconnectAttempts >= 1);
  assert.equal(second.status, "online");
  assert.equal(second.reconnectAttempts, 0);
});

test("stripping a bot mention preserves its ID for downstream handlers", () => {
  const engine = createAccountsEngine({
    store: fakeStore([]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: () => {},
  });

  const event = {
    body: "Zed explain gravity",
    mentions: { "fbid:12345": "Zed" },
  };

  assert.equal(engine.isMentioned(event, "12345"), true);

  const cleaned = engine.stripMentionFromEvent(event, "12345");

  assert.equal(cleaned.body, "explain gravity");
  assert.deepEqual(cleaned.mentions, { "fbid:12345": "Zed" });
  assert.equal(engine.isMentioned(cleaned, "12345"), true);
});
