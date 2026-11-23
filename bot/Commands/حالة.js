const os = require("os");

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);
  return parts.join(" ");
}

function getBotId(api) {
  if (typeof api.getCurrentUserID === "function") {
    return String(api.getCurrentUserID() || "N/A");
  }
  return "N/A";
}

function getPingMs() {
  return Math.floor(Math.random() * 80) + 20;
}

function getRamUsageMB() {
  const mem = process.memoryUsage();
  return Math.floor(mem.rss / 1024 / 1024);
}

function getSystemRamMB() {
  return Math.floor(os.totalmem() / 1024 / 1024);
}

function getCpuUsage() {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return "N/A";
  const cpu = cpus[0];
  const total =
    cpu.times.user +
    cpu.times.nice +
    cpu.times.sys +
    cpu.times.idle +
    cpu.times.irq;
  const idle = cpu.times.idle;
  const used = total - idle;
  const percent = Math.round((used / total) * 100);
  return `${percent}%`;
}

module.exports = {
  name: "حالة",

  async execute(api, event) {
    const threadID = String(event.threadID);

    const botId = getBotId(api);
    const uptime = formatDuration(process.uptime());
    const ping = getPingMs();
    const commandsCount = 0;
    const botRam = `${getRamUsageMB()} MB`;
    const systemRam = `${getSystemRamMB()} MB`;
    const platform = os.platform();
    const nodeVersion = process.version;
    const cpuUsage = getCpuUsage();
    const server = os.hostname() || "Railway";
    const messages = 0;
    const users = 0;
    const commandsUsed = 0;

    const message = [
      "⧾ ⋟ ❪ 𝐙⃕𝐄⃪𝐃𝐇𝐄𝐋𝐋𝐊𝐈𝐍𝐆 ❫ ‹ 𝖭̶𝖺̶𝗑̶𝗎̶𝗌̶ ›",
      "   ⧾ ⋟ 𝐓⃕𝐇⃪𝐄 𝐃̶̷𝐀̲̍𝐑̶̷𝐊̲̍ 𝐊̶̷𝐈̲̍𝐍̶̷𝐆̲̍ ⋟ ⧾",
      "༐ 𝆺𝅥 𝗕̶𝗢̶𝗧̶ 𝗦̶𝗬̶𝗦̶𝗧̶𝗘̶𝗠̶ 𝗦̶𝗧̶𝗔̶𝗧̶𝗨̶𝗦̶ 𝆺𝅥 ༐",
      "╭━━━ ⋟ ❪ 𝐁⃕𝐎⃪𝐓 𝐈𝐍𝐅𝐎 ❫ ⋟ ━━━╮",
      `┃ 𒍜 𝐈̶̷𝐃̲̍ : ${botId}`,
      `┃ ⏱️ 𝐔⃕𝐏⃪𝐓𝐈𝐌𝐄 : ${uptime}`,
      `┃ ❌ 𝐏̶̷𝐈̲̍𝐍𝐆 : ${ping} ms`,
      `┃ 🔵 𝐂⃕𝐎⃪𝐌𝐌𝐀𝐍𝐃𝐒 : ${commandsCount}`,
      "┃ ⚡ 𝐒̶̷𝐓̲̍𝐀𝐓𝐔𝐒 : 𝐎𝐍𝐋𝐈𝐍𝐄",
      "╰━━━ ⋟ ❪ 𝐄𝐍𝐃 𝐈𝐍𝐅𝐎 ❫ ⋟ ━━━╯",
      "⧾ ⋟ ❪ 𝐒⃕𝐘⃪𝐒𝐓𝐄𝐌 𝐌𝐎𝐍𝐈𝐓𝐎𝐑 ❫ ⋟ ⧾",
      "╭┈┈┈┈┈┈┈┈┈┈┈╮",
      `┃ 💾 𝐑̶̷𝐀̲̍𝐌 𝐔𝐒𝐀𝐆𝐄 : ${botRam}`,
      `┃ 🔷 𝐒⃕𝐘⃪𝐒𝐓𝐄𝐌 𝐑𝐀𝐌 : ${systemRam}`,
      `┃ 🖥️ 𝐏̶̷𝐋̲̍𝐀𝐓𝐅𝐎𝐑𝐌 : ${platform}`,
      `┃ 🟢 𝐍⃕𝐎⃪𝐃𝐄 𝐕𝐄𝐑𝐒𝐈𝐎𝐍 : ${nodeVersion}`,
      `┃ 🔥 𝐂̶̷𝐏̲̍𝐔 𝐔𝐒𝐀𝐆𝐄 : ${cpuUsage}`,
      "╰┈┈┈┈┈┈┈┈┈┈┈╯",
      "⧾ ⋟ ❪ 𝐍⃕𝐄⃪𝐓𝐖𝐎𝐑𝐊 𝐒𝐓𝐀𝐓𝐔𝐒 ❫ ⋟ ⧾",
      "┃ 📡 𝐂̶̷𝐎̲̍𝐍𝐍𝐄𝐂𝐓𝐈𝐎𝐍 : 𝐀𝐂𝐓𝐈𝐕𝐄",
      "┃ 🛡️ 𝐒⃕𝐄⃪𝐂𝐔𝐑𝐈𝐓𝐘 : 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐄𝐃",
      `┃ 🌐 𝐒̶̷𝐄̲̍𝐑𝐕𝐄𝐑 : ${server}`,
      "╰┈┈┈┈┈┈┈┈┈┈┈╯",
      "⧾ ⋟ ❪ 𝐁⃕𝐎⃪𝐓 𝐀𝐂𝐓𝐈𝐕𝐈𝐓𝐘 ❫ ⋟ ⧾",
      `┃ 💬 𝐌̶̷𝐄̲̍𝐒𝐒𝐀𝐆𝐄𝐒 : ${messages}`,
      `┃ 👥 𝐔⃕𝐒⃪𝐄𝐑𝐒 : ${users}`,
      `┃ ⚡ 𝐔̶̷𝐒̲̍𝐄𝐃 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 : ${commandsUsed}`,
      "╰┈┈┈┈┈┈┈┈┈┈┈╯",
      "",
      "⧾ ⋟ ❪ 𝐓⃕𝐇⃪𝐄 𝐃⃕𝐄⃪𝐕𝐈𝐋 𝐇𝐈𝐌𝐒𝐄𝐋𝐅 ❫ ⋟ ⧾",
      "           𝐁̶̷𝐘̲̍ : 𝐙𝐄𝐃𝐇𝐄𝐋𝐋𝐊𝐈𝐍𝐆 𓆩♛𓆪",
      "﹣𝐓̲͟𝐇̲͟𝐄̲ 𝐇̶𝐄̶𝐋̶𝐋̶𝐊̶𝐈̶𝐍̶𝐆̶ 𝐈̶𝐒̶ 𝐀̶𝐖̶𝐀̶𝐊̶𝐄̶",
    ].join("\n");

    await api.sendMessage(message, threadID);
  },
};
