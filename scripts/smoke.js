#!/usr/bin/env node
// smoke —— 冒烟回归：按 manifest 的「## 冒烟」表逐个动作跑最小真实用例，一条命令知道谁死了。
// 用法: node <skill目录>/scripts/smoke.js [--dir webapps/<service>] [--timeout 240] [--only <action>]
// 在站点目录下运行（默认 cwd），或用 --dir 指定。
// manifest 里需要这样一张表（参数用最小真实值，别用占位符）：
//   ## 冒烟
//   | 动作 | 参数 |
//   |---|---|---|
//   | top_models | --limit 3 |
//   | extract | --route /prices --limit 2 --out .smoke/extract.json |
// 串行执行（同一个常驻窗口，并发会互相抢标签页），失败总数非 0 时 exit 1。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const dir = path.resolve(process.cwd(), val("--dir", "."));
const timeout = Number(val("--timeout", "240")) * 1000;
const only = val("--only");

const manifest = path.join(dir, "manifest.md");
if (!fs.existsSync(manifest)) { console.error(`找不到 ${manifest}`); process.exit(2); }

const lines = fs.readFileSync(manifest, "utf8").split(/\r?\n/);
const start = lines.findIndex(l => /^##\s*冒烟/.test(l));
if (start < 0) {
  console.error("manifest 里没有「## 冒烟」表。加一段即可，例如：\n\n## 冒烟\n| 动作 | 参数 |\n|---|---|\n| top_models | --limit 3 |\n");
  process.exit(2);
}
const rows = [];
for (let i = start + 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith("|")) { if (line && rows.length) break; else continue; }
  const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  if (cells.every(c => /^-*:?$/.test(c) || c === "")) continue;       // 分隔行
  if (/^(动作|action)$/i.test(cells[0])) continue;                    // 表头
  if (cells[0]) rows.push({ action: cells[0], args: cells[1] || "" });
}
if (!rows.length) { console.error("「## 冒烟」表是空的"); process.exit(2); }

const results = [];
for (const row of rows) {
  if (only && row.action !== only) continue;
  const file = path.join(dir, "actions", `${row.action}.js`);
  if (!fs.existsSync(file)) { results.push({ action: row.action, status: "MISSING", note: "没有这个动作文件" }); continue; }
  const args = row.args ? row.args.split(/\s+/).filter(Boolean) : [];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file, ...args], { cwd: dir, timeout, encoding: "utf8" });
  const ms = Date.now() - t0;
  const killed = r.error && r.error.code === "ETIMEDOUT";
  const tail = ((r.stderr || "").trim().split(/\r?\n/).filter(Boolean).pop() || (r.stdout || "").trim().slice(0, 80)).slice(0, 90);
  results.push({ action: row.action, status: killed ? "TIMEOUT" : r.status === 0 ? "pass" : "FAIL", ms, note: r.status === 0 ? "" : tail });
}

const w = Math.max(...results.map(r => r.action.length), 6);
console.log(`冒烟：${dir}\n`);
for (const r of results) {
  console.log(`  ${r.action.padEnd(w)}  ${r.status.padEnd(7)} ${String(r.ms ?? "").padStart(6)}ms  ${r.note}`);
}
const bad = results.filter(r => r.status !== "pass").length;
console.log(`\n${results.length - bad}/${results.length} 通过`);
process.exit(bad ? 1 : 0);
