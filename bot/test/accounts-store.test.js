const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAccountsStore, encryptState, decryptState } = require("../accounts-store");

const silentLog = { error() {}, warn() {}, info() {} };
const STATE_A = [
  { key: "c_user", value: "1001" },
  { key: "xs", value: "abc" },
];
const STATE_B = [
  { key: "c_user", value: "2002" },
  { key: "xs", value: "xyz" },
];

function tempStore(password = "panel-password-123456") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zed-accounts-"));
  const filePath = path.join(dir, "accounts.enc.json");
  return { store: createAccountsStore({ filePath, password, log: silentLog }), filePath, dir };
}

test("cookies are encrypted at rest and never stored as plaintext", () => {
  const { store, filePath } = tempStore();
  const result = store.add({ name: "رئيسي", state: STATE_A });
  assert.equal(result.ok, true);
  const raw = fs.readFileSync(filePath, "utf8");
  assert.equal(raw.includes("1001"), false);
  assert.equal(raw.includes("abc"), false);
  assert.equal(raw.includes("c_user"), false);
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed.accounts[result.id].cookies.data, "string");
});

test("encrypt/decrypt roundtrip and wrong password fails", () => {
  const record = encryptState(STATE_A, "secret-1234567890");
  assert.deepEqual(decryptState(record, "secret-1234567890"), STATE_A);
  assert.throws(() => decryptState(record, "wrong-1234567890"));
});

test("add, list, rename, toggle, update and remove", () => {
  const { store } = tempStore();
  const a = store.add({ name: "حساب أول", state: STATE_A });
  const b = store.add({ name: "حساب ثاني", state: STATE_B });
  assert.equal(a.ok && b.ok, true);

  assert.equal(store.add({ name: "حساب أول", state: STATE_A }).ok, false);

  let list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].cookiesCount, 2);
  assert.equal(list[0].hasCUser && list[0].hasXs, true);
  assert.equal(list.some((x) => "cookies" in x), false);

  assert.equal(store.update(a.id, { name: "حساب ثاني" }).ok, false);
  assert.equal(store.update(a.id, { name: "معدل" }).ok, true);
  assert.equal(store.update(b.id, { state: STATE_A }).ok, true);

  assert.equal(store.setEnabled(b.id, false).ok, true);
  assert.equal(store.list().find((x) => x.id === b.id).enabled, false);

  assert.equal(store.remove(b.id).ok, true);
  assert.equal(store.list().length, 1);

  assert.equal(store.decrypt(a.id)[0].value, "1001");
});

test("store reloads encrypted data across restarts with same password", () => {
  const { store, filePath } = tempStore();
  const added = store.add({ name: "دائم", state: STATE_A });
  const reloaded = createAccountsStore({ filePath, password: "panel-password-123456", log: silentLog });
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].name, "دائم");
  assert.deepEqual(reloaded.decrypt(added.id), STATE_A);
});

test("store refuses to load with the wrong password", () => {
  const { store, filePath } = tempStore();
  store.add({ name: "سري", state: STATE_A });
  assert.throws(
    () => createAccountsStore({ filePath, password: "different-987654321", log: silentLog }),
    /ACCOUNTS_DECRYPT_FAILED/,
  );
});

test("rejects invalid appstate via the same validator as the main session", () => {
  const { store } = tempStore();
  assert.equal(store.add({ name: "x", state: [] }).ok, false);
  assert.equal(store.add({ name: "x", state: [{ key: "other", value: "1" }] }).ok, false);
  assert.equal(store.add({ name: "  ", state: STATE_A }).ok, false);
});
