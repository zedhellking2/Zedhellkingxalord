const fs = require("fs");
const path = require("path");

const PAGE_PATH = path.join(__dirname, "admin-panel.html");

function readPanelPage() {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

module.exports = { readPanelPage };
