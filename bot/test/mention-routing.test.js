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

function setupTwoBots(seen) {
  const listeners = new Map();
  const fakeLogin = (opts, loginOpts, cb) => {
    const id = opts.appState[0].value;
    const api = {
      ctx: { lastSeqId: "1" },
      getAppState: () => opts.appState,
      logout: () => {},
      listenMqtt: async (onEvent) => {
        listeners.set(id, onEvent);
        return () => listeners.delete(id);
      },
      getCurrentUserID: () => id,
    };
    setImmediate(() => cb(null, api));
  };

  const engine = createAccountsEngine({
    store: fakeStore([
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ]),
    onMessage: (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      seen.push({ botId: account.id, body: cleanEvent.body });
    },
    onEvent: () => {},
    log: silentLog,
    loginFn: fakeLogin,
  });

  return { engine, listeners };
}

test("command without mention reaches all bots", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m1",
    body: "قصف",
    senderID: "admin1",
  };
  listeners.get("100")(null, msg);
  listeners.get("200")(null, msg);
  await settle();

  assert.equal(seen.length, 2);
  assert.equal(seen[0].body, "قصف");
  assert.equal(seen[1].body, "قصف");
});

test("mentioning bot 100 makes only bot 100 execute the command", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  listeners.get("100")(null, {
    type: "message",
    threadID: "grp1",
    messageID: "m2",
    body: "Zed قصف",
    senderID: "admin1",
    mentions: { "100": "Zed" },
  });
  await settle();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].botId, "100");
  assert.equal(seen[0].body, "قصف");
});

test("mentioning bot 200 makes only bot 200 execute the command", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  listeners.get("200")(null, {
    type: "message",
    threadID: "grp1",
    messageID: "m3",
    body: "Zed قصف",
    senderID: "admin1",
    mentions: { "200": "Zed" },
  });
  await settle();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].botId, "200");
  assert.equal(seen[0].body, "قصف");
});

test("collective command (اوامر) without mention reaches all bots", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m4",
    body: "اوامر",
    senderID: "admin1",
  };
  listeners.get("100")(null, msg);
  listeners.get("200")(null, msg);
  await settle();

  assert.equal(seen.length, 2);
  assert.equal(seen[0].body, "اوامر");
  assert.equal(seen[1].body, "اوامر");
});

test("invalid mention (text-only @name without real mention data) does not route to single bot", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m5",
    body: "@Zed قصف",
    senderID: "admin1",
    mentions: {},
  };
  listeners.get("100")(null, msg);
  listeners.get("200")(null, msg);
  await settle();

  assert.equal(seen.length, 2);
  assert.equal(seen[0].body, "@Zed قصف");
  assert.equal(seen[1].body, "@Zed قصف");
});

test("mention with fbid: prefix normalizes correctly", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  listeners.get("100")(null, {
    type: "message",
    threadID: "grp1",
    messageID: "m6",
    body: "Zed قصف",
    senderID: "admin1",
    mentions: { "fbid:100": "Zed" },
  });
  await settle();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].botId, "100");
});

test("mentioning a third non-bot user does not block all bots", async () => {
  const seen = [];
  const { engine, listeners } = setupTwoBots(seen);

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m7",
    body: "@user قصف",
    senderID: "admin1",
    mentions: { "999": "user" },
  };
  listeners.get("100")(null, msg);
  listeners.get("200")(null, msg);
  await settle();

  assert.equal(seen.length, 2);
  assert.equal(seen[0].body, "@user قصف");
  assert.equal(seen[1].body, "@user قصف");
});

test("stripMentionFromEvent removes mention text but preserves other mentions", () => {
  const engine = createAccountsEngine({
    store: fakeStore([]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: () => {},
  });

  const event = {
    body: "Zed قصف",
    mentions: { "100": "Zed", "999": "user" },
  };

  const cleaned = engine.stripMentionFromEvent(event, "100");
  assert.equal(cleaned.body, "قصف");
  assert.deepEqual(cleaned.mentions, { "100": "Zed", "999": "user" });
});

test("isAnyBotMentioned returns false for empty mentions", () => {
  const engine = createAccountsEngine({
    store: fakeStore([]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: () => {},
  });

  assert.equal(engine.isAnyBotMentioned({ mentions: {} }, ["100", "200"]), false);
  assert.equal(engine.isAnyBotMentioned({}, ["100", "200"]), false);
  assert.equal(engine.isAnyBotMentioned(null, ["100", "200"]), false);
});

test("isMentioned handles fbid: prefix and plain IDs", () => {
  const engine = createAccountsEngine({
    store: fakeStore([]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: () => {},
  });

  assert.equal(engine.isMentioned({ mentions: { "fbid:123": "Zed" } }, "123"), true);
  assert.equal(engine.isMentioned({ mentions: { "123": "Zed" } }, "fbid:123"), true);
  assert.equal(engine.isMentioned({ mentions: { "456": "Zed" } }, "123"), false);
  assert.equal(engine.isMentioned({ mentions: {} }, "123"), false);
  assert.equal(engine.isMentioned(null, "123"), false);
});
