const { createListenerSession } = require("./listener-session");
const { classifyError } = require("./login-errors");
const { normalizeFacebookID } = require("./main");

const LOGIN_OPTIONS = {
  listenEvents: true,
  selfListen: false,
  autoMarkDelivery: false,
  autoMarkRead: false,
  forceLogin: false,
  autoReconnect: false,
  online: true,
};

const RECONNECT_BASE_MS = 15000;
const RECONNECT_MAX_MS = 300000;

function snapshot(account) {
  return {
    id: account.id,
    name: account.name,
    enabled: account.enabled,
    status: account.status,
    loggedIn: account.loggedIn,
    listenerActive: account.listenerActive,
    lastError: account.lastError,
    lastConnectedAt: account.lastConnectedAt,
    lastEventAt: account.lastEventAt,
    messagesSeen: account.messagesSeen,
    reconnectAttempts: account.reconnectAttempts,
  };
}

function createAccount({ id, name, onMessage, onEvent, log, fcaLogin }) {
  const account = {
    id,
    name,
    enabled: true,
    api: null,
    listener: createListenerSession({ log }),
    status: "stopped",
    loggedIn: false,
    listenerActive: false,
    lastError: null,
    lastConnectedAt: null,
    lastEventAt: null,
    messagesSeen: 0,
    reconnectAttempts: 0,
    loginInFlight: false,
    reconnectTimer: null,
    stopping: false,
    appState: null,
  };

  function clearReconnectTimer() {
    if (account.reconnectTimer) {
      clearTimeout(account.reconnectTimer);
      account.reconnectTimer = null;
    }
  }

  function stopListener(reason) {
    account.listener.stop(reason);
    account.listenerActive = false;
    account.api = null;
  }

  function scheduleReconnect(reason) {
    if (account.stopping || !account.enabled) return;
    clearReconnectTimer();
    account.reconnectAttempts += 1;
    const backoff = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(account.reconnectAttempts - 1, 4), RECONNECT_MAX_MS);
    const delay = backoff * (0.8 + Math.random() * 0.4);
    account.status = "reconnecting";
    log.warn("accounts", "انقطع اتصال الحساب، جاري إعادة المحاولة", {
      id: account.id,
      reason,
      attempt: account.reconnectAttempts,
      delayMs: Math.round(delay),
    });
    account.reconnectTimer = setTimeout(() => {
      account.reconnectTimer = null;
      start();
    }, delay);
    account.reconnectTimer.unref();
  }

  function onListenerEvent(api, err, event) {
    if (err) {
      const kind = classifyError(err);
      account.lastError = kind;
      log.error("accounts", "خطأ في مستمع الحساب", { id: account.id, kind });
      if (kind === "checkpoint" || kind === "session_expired") {
        stopListener(kind);
        account.status = "needs_attention";
        return;
      }
      stopListener(kind);
      scheduleReconnect(kind);
      return;
    }
    if (!event) return;
    account.lastEventAt = Date.now();
    if (event.type === "message" || event.type === "message_reply") {
      account.messagesSeen += 1;
      onMessage(account, event);
    }
    onEvent(account, event);
  }

  async function startListening() {
    try {
      const result = await account.listener.start(account.api, (err, event) =>
        onListenerEvent(account.api, err, event),
      );
      if (!result.started) return;
      account.listenerActive = true;
      account.status = "online";
      account.reconnectAttempts = 0;
      account.lastConnectedAt = new Date().toISOString();
      log.info("accounts", "الحساب يعمل الآن", { id: account.id, name: account.name });
    } catch (error) {
      log.error("accounts", "فشل بدء مستمع الحساب", { id: account.id, message: error.message });
      scheduleReconnect("listen_start_failed");
    }
  }

  function onLoginResult(err, api) {
    account.loginInFlight = false;
    if (account.stopping) {
      if (api && typeof api.stopListenMqtt === "function") {
        try { api.logout(() => {}); } catch {}
      }
      return;
    }

    if (err) {
      const kind = classifyError(err);
      account.loggedIn = false;
      account.lastError = kind;
      log.error("accounts", "فشل تسجيل دخول الحساب", { id: account.id, kind });
      if (kind === "checkpoint" || kind === "session_expired") {
        account.status = "needs_attention";
        return;
      }
      account.status = "reconnecting";
      scheduleReconnect("login_failed");
      return;
    }

    account.api = api;
    account.loggedIn = true;
    account.lastError = null;
    account.appState = api.getAppState();
    log.info("accounts", "تم تسجيل دخول الحساب", { id: account.id, name: account.name });
    if (api.ctx && api.ctx.lastSeqId) api.ctx.firstListen = true;
    startListening();
  }

  function start() {
    if (account.stopping || account.loginInFlight || account.listener.active) return;
    if (!account.enabled || !account.appState) {
      account.status = account.enabled ? "no_cookies" : "disabled";
      return;
    }
    account.loginInFlight = true;
    account.status = "connecting";
    fcaLogin({ appState: account.appState }, LOGIN_OPTIONS, onLoginResult);
  }

  function stop() {
    account.stopping = true;
    clearReconnectTimer();
    stopListener("stopped");
    account.loggedIn = false;
    account.status = "stopped";
  }

  return { account, start, stop };
}

function isMentioned(event, botID) {
  if (!event || !event.mentions) return false;
  if (typeof event.mentions !== "object") return false;
  const normalizedBot = normalizeFacebookID(botID);
  if (!normalizedBot) return false;
  for (const mentionID of Object.keys(event.mentions)) {
    if (normalizeFacebookID(mentionID) === normalizedBot) return true;
  }
  return false;
}

function stripMentionFromEvent(event, botID) {
  if (!event || !event.mentions) return event;
  const mentions = { ...event.mentions };
  let body = String(event.body || "");
  const normalizedBot = normalizeFacebookID(botID);
  for (const [mentionID, tag] of Object.entries(mentions)) {
    if (normalizeFacebookID(mentionID) === normalizedBot) {
      if (typeof tag === "string" && tag.trim()) {
        body = body.replace(tag, " ");
      }
    }
  }
  body = body.replace(/\s+/g, " ").trim();
  return { ...event, body, mentions };
}

function createAccountsEngine({ store, onMessage, onEvent, log, loginFn, contextFactory }) {
  const fcaLogin = loginFn || require("ws3-fca").login;
  const accounts = new Map();
  const makeContext = contextFactory || (() => null);

  function getAllBotIds() {
    const ids = [];
    for (const entry of accounts.values()) {
      const api = entry.account.api;
      if (api && typeof api.getCurrentUserID === "function") {
        const id = String(api.getCurrentUserID() || "");
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  function isAnyBotMentioned(event, allBotIds) {
    if (!event || !event.mentions || typeof event.mentions !== "object") return false;
    const mentionIds = Object.keys(event.mentions).map(normalizeFacebookID);
    return allBotIds.some((botId) => mentionIds.includes(normalizeFacebookID(botId)));
  }

  async function startAccount(idText, state) {
    const record = store.get(idText);
    if (!record) return { ok: false, error: "not_found" };
    let entry = accounts.get(idText);
    if (entry) {
      if (entry.account.listener.active || entry.account.loginInFlight) {
        return { ok: false, error: "already_running" };
      }
      entry.account.stopping = false;
      entry.account.enabled = true;
      if (state) entry.account.appState = state;
      entry.start();
      return { ok: true };
    }
    entry = createAccount({ id: record.id, name: record.name, onMessage, onEvent, log, fcaLogin });
    entry.context = makeContext(record.id);
    if (entry.context) entry.context.loadCommands();
    accounts.set(idText, entry);
    entry.account.enabled = true;
    entry.account.appState = state || store.decrypt(idText);
    if (!entry.account.appState) return { ok: false, error: "decrypt_failed" };
    entry.start();
    return { ok: true };
  }

  function stopAccount(idText) {
    const entry = accounts.get(idText);
    if (!entry) return { ok: false, error: "not_running" };
    if (entry.context && typeof entry.context.stopAllCommands === "function") {
      try { entry.context.stopAllCommands(); } catch (e) {
        log.warn("accounts", "خطأ في إيقاف أوامر الحساب", { id: idText, message: e.message });
      }
    }
    entry.stop();
    return { ok: true };
  }

  function removeAccount(idText) {
    const entry = accounts.get(idText);
    if (entry) {
      if (entry.context && typeof entry.context.stopAllCommands === "function") {
        try { entry.context.stopAllCommands(); } catch (e) {
          log.warn("accounts", "خطأ في إيقاف أوامر الحساب قبل الحذف", { id: idText, message: e.message });
        }
      }
      entry.stop();
      accounts.delete(idText);
    }
    return { ok: true };
  }

  async function startAll() {
    const summaries = store.list();
    let started = 0;
    for (const summary of summaries) {
      if (!summary.enabled) continue;
      const result = await startAccount(summary.id);
      if (result.ok) started += 1;
      else log.warn("accounts", "تعذر بدء تشغيل الحساب", { id: summary.id, error: result.error });
    }
    log.info("accounts", "تم بدء تشغيل الحسابات المفعلة", { started, total: summaries.length });
  }

  function stopAll() {
    for (const entry of accounts.values()) {
      if (entry.context && typeof entry.context.stopAllCommands === "function") {
        try { entry.context.stopAllCommands(); } catch {}
      }
      entry.stop();
    }
  }

  function statuses() {
    return Array.from(accounts.values()).map((entry) => snapshot(entry.account));
  }

  function statusOf(idText) {
    const entry = accounts.get(idText);
    return entry ? snapshot(entry.account) : null;
  }

  return {
    startAccount,
    stopAccount,
    removeAccount,
    startAll,
    stopAll,
    statuses,
    statusOf,
    getAllBotIds,
    isAnyBotMentioned,
    isMentioned,
    stripMentionFromEvent,
    accounts,
  };
}

module.exports = { createAccountsEngine };
