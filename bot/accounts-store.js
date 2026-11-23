const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("./atomic-file");
const { validateAppState } = require("./session-store");

const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };
const VERSION = 1;

function deriveKey(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN, SCRYPT_COST);
}

function encryptState(state, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt.toString("hex"));
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(state), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: VERSION,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("base64"),
  };
}

function decryptState(record, password) {
  const key = deriveKey(password, record.salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "hex"));
  decipher.setAuthTag(Buffer.from(record.tag, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(record.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8"));
}

function emptyData() {
  return { version: VERSION, nextId: 1, accounts: {} };
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function summaryOf(state) {
  const names = Array.isArray(state) ? state.map((item) => item.key) : [];
  return { cookiesCount: names.length, hasCUser: names.includes("c_user"), hasXs: names.includes("xs") };
}

function createAccountsStore({ filePath, password, log }) {
  let data = emptyData();
  let lastCipherText = null;

  function load() {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.accounts) throw new Error("bad_shape");
      if (parsed.version !== VERSION) throw new Error("bad_version");
      for (const [id, record] of Object.entries(parsed.accounts)) {
        decryptState(record.cookies, password);
        data.accounts[id] = record;
      }
      data.nextId = Number(parsed.nextId) || 1;
      log.info("accounts", "تم تحميل مخزن الحسابات", { count: Object.keys(data.accounts).length });
    } catch (error) {
      if (error.code !== "ENOENT") {
        log.error("accounts", "تعذر فك تشفير مخزن الحسابات", { message: error.message });
        throw new Error("ACCOUNTS_DECRYPT_FAILED");
      }
      persist();
      log.info("accounts", "تم إنشاء مخزن حسابات جديد مشفر");
    }
  }

  function persist() {
    const serialized = JSON.stringify(data, null, 2);
    writeFileAtomic(filePath, serialized);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {}
    lastCipherText = serialized;
  }

  function id(idText) {
    const key = String(idText || "").trim();
    if (!/^\d+$/.test(key)) return null;
    return key;
  }

  load();

  return {
    add({ name, state }) {
      const cleanName = normalizeName(name);
      if (!cleanName) return { ok: false, error: "invalid_name" };
      const check = validateAppState(state);
      if (!check.ok) return { ok: false, error: "invalid_state" };
      for (const account of Object.values(data.accounts)) {
        if (account.name === cleanName) return { ok: false, error: "name_taken" };
      }
      const newId = String(data.nextId);
      data.nextId += 1;
      data.accounts[newId] = {
        id: newId,
        name: cleanName,
        enabled: true,
        createdAt: new Date().toISOString(),
        cookies: encryptState(state, password),
      };
      persist();
      return { ok: true, id: newId };
    },

    update(idText, { name, state }) {
      const account = data.accounts[id(idText)];
      if (!account) return { ok: false, error: "not_found" };
      if (name !== undefined) {
        const cleanName = normalizeName(name);
        if (!cleanName) return { ok: false, error: "invalid_name" };
        for (const other of Object.values(data.accounts)) {
          if (other.id !== account.id && other.name === cleanName) return { ok: false, error: "name_taken" };
        }
        account.name = cleanName;
      }
      if (state !== undefined) {
        const check = validateAppState(state);
        if (!check.ok) return { ok: false, error: "invalid_state" };
        account.cookies = encryptState(state, password);
      }
      persist();
      return { ok: true };
    },

    remove(idText) {
      const account = data.accounts[id(idText)];
      if (!account) return { ok: false, error: "not_found" };
      delete data.accounts[account.id];
      persist();
      return { ok: true };
    },

    setEnabled(idText, enabled) {
      const account = data.accounts[id(idText)];
      if (!account) return { ok: false, error: "not_found" };
      account.enabled = Boolean(enabled);
      persist();
      return { ok: true };
    },

    get(idText) {
      return data.accounts[id(idText)] || null;
    },

    list() {
      return Object.values(data.accounts).map((account) => {
        let summary = { cookiesCount: 0, hasCUser: false, hasXs: false };
        try {
          summary = summaryOf(decryptState(account.cookies, password));
        } catch (error) {
          log.error("accounts", "تعذر فك تشفير كوكيز الحساب", { id: account.id, message: error.message });
        }
        return {
          id: account.id,
          name: account.name,
          enabled: account.enabled,
          createdAt: account.createdAt,
          ...summary,
        };
      });
    },

    decrypt(idText) {
      const account = data.accounts[id(idText)];
      if (!account) return null;
      try {
        return decryptState(account.cookies, password);
      } catch (error) {
        log.error("accounts", "تعذر فك تشفير كوكيز الحساب", { id: account.id, message: error.message });
        return null;
      }
    },
  };
}

module.exports = { createAccountsStore, encryptState, decryptState, normalizeName };
