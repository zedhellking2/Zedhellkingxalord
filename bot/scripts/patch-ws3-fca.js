const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../node_modules/ws3-fca/src");

function patch(fileName, transforms) {
  const file = path.join(root, fileName);

  if (!fs.existsSync(file)) {
    throw new Error(`الملف غير موجود: ${fileName}`);
  }

  let source = fs.readFileSync(file, "utf8");
  let changed = false;

  for (const [oldText, newText, description] of transforms) {
    if (newText ? source.includes(newText) : !source.includes(oldText)) {
      continue;
    }

    if (!source.includes(oldText)) {
      throw new Error(
        `تعذر تطبيق ${description} في ${fileName}: بنية الملف غير متوقعة`
      );
    }

    source = source.replace(oldText, newText);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, source);
    console.log(`تم إصلاح ${fileName}`);
  } else {
    console.log(`${fileName}: الإصلاح موجود بالفعل`);
  }
}

try {
  patch("deltas/apis/mqtt/listenMqtt.js", [
    [
      "let form = {};\nlet getSeqID;\nconst topics",
      "const topics",
      "عزل متغيرات MQTT",
    ],
    [
      "module.exports = (defaultFuncs, api, ctx) => {\n",
      "module.exports = (defaultFuncs, api, ctx) => {\n    let form = {};\n    let getSeqID;\n",
      "نقل متغيرات MQTT داخل الجلسة",
    ],
  ]);

  patch("utils/axios.js", [
    [
      "const jar = new CookieJar();\nconst client = wrapper(axios.create({ jar }));",
      `const defaultClient = wrapper(axios.create());
const clientsByJar = new WeakMap();

function getClient(reqJar) {
    if (!reqJar || typeof reqJar !== "object") {
        return defaultClient;
    }

    let client = clientsByJar.get(reqJar);

    if (!client) {
        client = wrapper(axios.create({ jar: reqJar }));
        clientsByJar.set(reqJar, client);
    }

    return client;
}`,
      "إنشاء Axios مستقل لكل Cookie Jar",
    ],
    [
      "const fn = () => client.get(url, { timeout: 60000, ...proxyConfig });",
      "const fn = () => defaultClient.get(url, { timeout: 60000, ...proxyConfig });",
      "عزل طلب cleanGet",
    ],
    [
      "return requestWithRetry(async () => await client.get(url, config));",
      "return requestWithRetry(async () => await getClient(reqJar).get(url, config));",
      "ربط GET بمخزن الحساب",
    ],
    [
      "return requestWithRetry(async () => await client.post(url, data, config));",
      "return requestWithRetry(async () => await getClient(reqJar).post(url, data, config));",
      "ربط POST بمخزن الحساب",
    ],
    [
      "return requestWithRetry(async () => await client.post(url, formData, config));",
      "return requestWithRetry(async () => await getClient(reqJar).post(url, formData, config));",
      "ربط POST FormData بمخزن الحساب",
    ],
    [
      "getJar: () => jar,",
      "getJar: () => new CookieJar(),",
      "إنشاء Cookie Jar جديد لكل تسجيل دخول",
    ],
  ]);

  patch("core/client.js", [
    [
      "let globalOptions = {};\nlet ctx = null;\nlet defaultFuncs = null;\nlet api = null;\n\n",
      "",
      "إزالة حالة تسجيل الدخول العامة",
    ],
    [
      "        options = {};\n    }\n    if ('logging' in options) {",
      "        options = {};\n    }\n    options = options || {};\n    if ('logging' in options) {",
      "معالجة خيارات تسجيل الدخول",
    ],
    [
      "    Object.assign(globalOptions, defaultOptions, options);",
      "    const globalOptions = { ...defaultOptions, ...options };",
      "إنشاء خيارات مستقلة لكل حساب",
    ],
    [
      `            if (loginError) {
                return callback(loginError);
            }
            api = loginApi;
            ctx = loginApi.ctx;
            defaultFuncs = loginApi.defaultFuncs;
            return callback(null, loginApi);`,
      `            if (loginError) {
                return callback(loginError);
            }
            return callback(null, loginApi);`,
      "إزالة مشاركة API بين الحسابات",
    ],
    [
      "        api,\n        fbLink,",
      "        null,\n        fbLink,",
      "منع إعادة استخدام API الحساب السابق",
    ],
  ]);

  console.log("\nتم تطبيق إصلاحات عزل جلسات ws3-fca.");
} catch (error) {
  console.error("\nفشل تطبيق الإصلاح:", error.message);
  process.exit(1);
}
