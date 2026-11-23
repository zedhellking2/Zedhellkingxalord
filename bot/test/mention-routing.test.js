const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccountsEngine } = require("../accounts-engine");
const { createCommandContext } = require("../main");

const silentLog = { error() {}, warn() {}, info() {} };

function stopQasfLoops() {
  try {
    const qasf = require("../Commands/قصف");
    if (qasf && typeof qasf.stopAll === "function") qasf.stopAll();
  } catch {}
}

function fakeStore(records) {
  return {
    get: (id) => records.find((r) => r.id === id) || null,
    list: () => records.map(({ id, name, enabled }) => ({ id, name, enabled })),
    decrypt: (id) => (records.some((r) => r.id === id) ? [{ key: "c_user", value: id }] : null),
  };
}

function settle(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeFakeApi(id, sentMessages) {
  return {
    ctx: { lastSeqId: "1" },
    getAppState: () => [{ key: "c_user", value: id }],
    logout: () => {},
    getCurrentUserID: () => id,
    sendMessage: async (text, threadID) => {
      sentMessages.push({ botId: id, text: String(text).slice(0, 40), threadID });
    },
    setMessageReaction: async () => {},
    listenMqtt: async (onEvent) => {
      return () => {};
    },
  };
}

function setupEngine(records, onMessage) {
  const listeners = new Map();
  const sentMessages = [];

  const fakeLogin = (opts, loginOpts, cb) => {
    const id = opts.appState[0].value;
    const api = makeFakeApi(id, sentMessages);
    api.listenMqtt = async (onEvent) => {
      listeners.set(id, onEvent);
      return () => listeners.delete(id);
    };
    setImmediate(() => cb(null, api));
  };

  const engine = createAccountsEngine({
    store: fakeStore(records),
    onMessage: onMessage,
    onEvent: () => {},
    log: silentLog,
    loginFn: fakeLogin,
    contextFactory: () => {
      const ctx = createCommandContext();
      ctx.loadCommands();
      return ctx;
    },
  });

  return { engine, listeners, sentMessages };
}

function stopAllQasf() {
  try {
    const qasf = require("../Commands/قصف");
    if (qasf && typeof qasf.stopAll === "function") qasf.stopAll();
  } catch {}
}

function deliverToAll(listeners, event) {
  for (const cb of listeners.values()) {
    cb(null, event);
  }
}

test("command without mention reaches all bots — both execute", async () => {
  const delivered = [];
  const { engine, listeners } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m1",
    body: "قصف",
    senderID: "100078389536244",
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 2, "both bots should receive the message");
  assert.equal(delivered[0].body, "قصف");
  assert.equal(delivered[1].body, "قصف");
  stopAllQasf();
});

test("mentioning bot 100 makes only bot 100 execute — bot 200 sends nothing", async () => {
  const delivered = [];
  const { engine, listeners, sentMessages } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m2",
    body: "Zed قصف",
    senderID: "100078389536244",
    mentions: { "100": "Zed" },
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 1, "only bot 100 should process the message");
  assert.equal(delivered[0].botId, "100");
  assert.equal(delivered[0].body, "قصف", "mention text should be stripped");

  const bot200Messages = sentMessages.filter((m) => m.botId === "200");
  assert.equal(bot200Messages.length, 0, "bot 200 must not send any reply");
  stopAllQasf();
});

test("mentioning bot 200 makes only bot 200 execute — bot 100 sends nothing", async () => {
  const delivered = [];
  const { engine, listeners, sentMessages } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m3",
    body: "Zed قصف",
    senderID: "100078389536244",
    mentions: { "200": "Zed" },
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 1, "only bot 200 should process the message");
  assert.equal(delivered[0].botId, "200");
  assert.equal(delivered[0].body, "قصف");

  const bot100Messages = sentMessages.filter((m) => m.botId === "100");
  assert.equal(bot100Messages.length, 0, "bot 100 must not send any reply");
  stopAllQasf();
});

test("collective command اوامر without mention reaches all bots", async () => {
  const delivered = [];
  const { engine, listeners } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m4",
    body: "اوامر",
    senderID: "100078389536244",
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 2, "both bots should receive اوامر");
  assert.equal(delivered[0].body, "اوامر");
  assert.equal(delivered[1].body, "اوامر");
  stopAllQasf();
});

test("invalid mention (text-only @name without real mention data) does not block — all bots execute", async () => {
  const delivered = [];
  const { engine, listeners } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m5",
    body: "@Zed قصف",
    senderID: "100078389536244",
    mentions: {},
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 2, "both bots should process — no real mention");
  assert.equal(delivered[0].body, "@Zed قصف");
  assert.equal(delivered[1].body, "@Zed قصف");
  stopAllQasf();
});

test("mention with fbid: prefix normalizes correctly — only mentioned bot executes", async () => {
  const delivered = [];
  const { engine, listeners } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m6",
    body: "Zed قصف",
    senderID: "100078389536244",
    mentions: { "fbid:100": "Zed" },
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 1, "only bot 100 should execute via fbid: prefix");
  assert.equal(delivered[0].botId, "100");
  stopAllQasf();
});

test("mentioning a non-bot user does not block all bots — all execute", async () => {
  const delivered = [];
  const { engine, listeners } = setupEngine(
    [
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ],
    (account, event) => {
      const botID = String(account.api.getCurrentUserID());
      const allBotIds = engine.getAllBotIds();
      const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
      if (anyMentioned && !engine.isMentioned(event, botID)) return;
      const cleanEvent = anyMentioned
        ? engine.stripMentionFromEvent(event, botID)
        : event;
      const entry = engine.accounts.get(account.id);
      if (!entry || !entry.context) return;
      delivered.push({ botId: account.id, body: cleanEvent.body });
      Promise.resolve(entry.context.handleMessage(account.api, cleanEvent)).catch(() => {});
    },
  );

  await engine.startAll();
  await settle();

  const msg = {
    type: "message",
    threadID: "grp1",
    messageID: "m7",
    body: "@user قصف",
    senderID: "100078389536244",
    mentions: { "999": "user" },
  };
  deliverToAll(listeners, msg);
  await settle(300);

  assert.equal(delivered.length, 2, "both bots should process — mention is not a bot");
  stopAllQasf();
});

test("disconnected mentioned bot still recognized — other bots do not execute the command", async () => {
  const listeners = new Map();
  const fakeLogin = (opts, loginOpts, cb) => {
    const id = opts.appState[0].value;
    const api = {
      ctx: { lastSeqId: "1" },
      getAppState: () => opts.appState,
      logout: () => {},
      getCurrentUserID: () => id,
      listenMqtt: async (onEvent) => {
        listeners.set(id, onEvent);
        return () => listeners.delete(id);
      },
    };
    setImmediate(() => cb(null, api));
  };

  const engine = createAccountsEngine({
    store: fakeStore([
      { id: "100", name: "بوت أ", enabled: true },
      { id: "200", name: "بوت ب", enabled: true },
    ]),
    onMessage: () => {},
    onEvent: () => {},
    log: silentLog,
    loginFn: fakeLogin,
  });

  await engine.startAll();
  await settle();

  const bot100Entry = engine.accounts.get("100");
  bot100Entry.account.api = null;
  bot100Entry.account.loggedIn = false;
  bot100Entry.account.status = "reconnecting";

  const event = {
    body: "Zed قصف",
    mentions: { "100": "Zed" },
  };

  const allBotIds = engine.getAllBotIds();
  assert.ok(
    allBotIds.includes("100"),
    "getAllBotIds must include bot 100 even when its api is disconnected",
  );
  assert.ok(
    allBotIds.includes("200"),
    "getAllBotIds must include bot 200",
  );

  const anyMentioned = engine.isAnyBotMentioned(event, allBotIds);
  assert.equal(anyMentioned, true, "isAnyBotMentioned must be true even if mentioned bot has no live api");
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

test("isAnyBotMentioned returns false for empty/null mentions", () => {
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

test("isMentioned handles fbid: prefix and plain IDs symmetrically", () => {
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

test.after(() => {
  stopAllQasf();
  setTimeout(() => process.exit(0), 100);
});
