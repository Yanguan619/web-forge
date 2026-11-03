#!/usr/bin/env node
// probe —— web-forge 勘探快路径：一次输出页面的可自动化锚点全景
//（testid / 按钮链接输入 / 表格 / canvas / iframe / 最终 URL）。
// 用法: node <skill目录>/scripts/probe.js <url> [--wait 3000] [--out file.json] [--json]
// 在装了 playwright 的 webapps/<service> 里运行（依赖从运行目录解析）。
// 一律有头；且**连已有常驻浏览器**（9222）：同窗口、同登录态，跑完不关窗、不断开页面。
//
// 与站点动作共享同一个浏览器实例：谁先跑谁拉起（profile 落 <cwd>/.auth/profile），
// 之后 probe 与 actions/*.js 都 connectOverCDP 连它——不会出现第二个窗口。

const fs = require("fs"), path = require("path");
const { createRequire } = require("module");
function loadPlaywright() { // 依赖从「运行目录」解析，回退脚本自身目录
  try { return createRequire(path.join(process.cwd(), "index.js"))("playwright"); }
  catch { return require("playwright"); }
}
const { chromium } = loadPlaywright();

const argv = process.argv.slice(2);
const VALUED = new Set(["--wait", "--out", "--state", "--profile"]);
const url = argv.find((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt; };
if (!url) { console.error("用法: node probe.js <url> [--wait 3000] [--out file.json] [--json]"); process.exit(2); }

const waitMs = Number(val("--wait", "3000"));
const outFile = val("--out");
const asJson = argv.includes("--json") || !!outFile;
const legacyState = val("--state"); // 旧 forge 的 storageState，仅首次建 profile 时有用
process.env.FORGE_AUTH_DIR = path.join(process.cwd(), ".auth"); // 登录态跟着当前站点目录走
if (legacyState) {
  const dst = path.join(process.env.FORGE_AUTH_DIR, "state.json");
  if (fs.existsSync(path.resolve(legacyState)) && !fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.resolve(legacyState), dst);
  }
}

const { ensureBrowser, getPage, detach } = require("./browser");

(async () => {
  const { browser, ctx } = await ensureBrowser(chromium, { viewport: { width: 1440, height: 900 } });
  const page = await getPage(ctx, url);
  // 已经在同一地址就不重复导航（保留 SPA 状态）；否则整页跳过去
  const same = (() => { try { return page.url().split("#")[0] === url.split("#")[0]; } catch { return false; } })();
  if (!same) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => console.error("[goto] " + e.message));
  await page.waitForTimeout(waitMs);

  const data = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const nm = el => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 48);

    const testids = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("[data-testid]")) {
      if (!vis(el)) continue;
      const tid = el.getAttribute("data-testid");
      if (seen.has(tid)) continue; seen.add(tid);
      testids.push({ tid, tag: el.tagName.toLowerCase(), text: nm(el) });
    }

    const interactive = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab], [role=menuitem], [contenteditable=true]")) {
      if (!vis(el)) continue;
      const name = nm(el);
      if (!name && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") continue;
      interactive.push({ tag: el.tagName.toLowerCase(), name, href: el.getAttribute("href") || undefined, type: el.getAttribute("type") || undefined });
      if (interactive.length >= 120) break;
    }

    const tables = [...document.querySelectorAll("table")].filter(vis).map(t => ({
      headers: [...t.querySelectorAll("th")].slice(0, 10).map(th => (th.innerText || "").trim()).filter(Boolean),
      rows: t.querySelectorAll("tbody tr").length,
    }));
    const canvases = [...document.querySelectorAll("canvas")].filter(vis).length;
    const iframes = [...document.querySelectorAll("iframe")].filter(vis).map(f => f.src).slice(0, 5);
    return { title: document.title, testids, interactive, tables, canvases, iframes, texts: document.body.innerText.slice(0, 600).replace(/\n{3,}/g, "\n\n") };
  });

  const out = { url, finalUrl: page.url(), ...data };
  // iframe 壳架构站点：壳上只有导航，功能在帧里——逐帧下钻同样 dump
  const frames = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const fd = await f.evaluate(() => {
        const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const nm = el => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 48);
        const testids = []; const seen = new Set();
        for (const el of document.querySelectorAll("[data-testid]")) {
          if (!vis(el)) continue; const tid = el.getAttribute("data-testid");
          if (seen.has(tid)) continue; seen.add(tid); testids.push({ tid, tag: el.tagName.toLowerCase(), text: nm(el) });
        }
        const interactive = [];
        for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [contenteditable=true]")) {
          if (!vis(el)) continue; const name = nm(el);
          if (!name && !["INPUT", "TEXTAREA"].includes(el.tagName)) continue;
          interactive.push({ tag: el.tagName.toLowerCase(), name, href: el.getAttribute("href") || undefined, type: el.getAttribute("type") || undefined });
          if (interactive.length >= 80) break;
        }
        return { testids, interactive, text: document.body.innerText.slice(0, 400).replace(/\n{3,}/g, "\n\n") };
      });
      frames.push({ src: f.url(), ...fd });
    } catch { frames.push({ src: f.url(), error: "不可访问（跨域隔离）" }); }
  }
  out.frames = frames;

  if (asJson) {
    const payload = JSON.stringify(out, null, 1);
    if (outFile) fs.writeFileSync(outFile, payload, "utf8"); // 落文件才是干净 UTF-8
    console.log(payload);
  } else {
    console.log(`URL: ${out.url}\n最终: ${out.finalUrl}\n标题: ${out.title}\ncanvas: ${out.canvases} · 表格: ${out.tables.length} · iframe: ${out.iframes.length}`);
    console.log(`\n== data-testid (${data.testids.length}) ==`);
    for (const t of data.testids) console.log(`  ${t.tid} | ${t.tag} | ${t.text}`);
    console.log(`\n== 可交互元素 (${data.interactive.length}) ==`);
    for (const t of data.interactive) console.log(`  ${t.tag} | ${t.name}${t.href ? " -> " + String(t.href).slice(0, 60) : ""}${t.type ? " [" + t.type + "]" : ""}`);
    if (data.tables.length) { console.log(`\n== 表格 ==`); for (const t of data.tables) console.log(`  列: ${t.headers.join(" / ")} | 行数: ${t.rows}`); }
    if (data.iframes.length) { console.log(`\n== iframe ==`); for (const s of data.iframes) console.log("  " + s); }
    console.log(`\n== 正文首屏 ==\n${data.texts}`);
    for (const fr of out.frames) {
      console.log(`\n===== iframe: ${fr.src} =====`);
      if (fr.error) { console.log("  " + fr.error); continue; }
      console.log(`testid: ${fr.testids.length} · 可交互: ${fr.interactive.length}`);
      for (const t of fr.testids.slice(0, 40)) console.log(`  ${t.tid} | ${t.tag} | ${t.text}`);
      for (const t of fr.interactive.slice(0, 60)) console.log(`  ${t.tag} | ${t.name}${t.href ? " -> " + String(t.href).slice(0, 50) : ""}${t.type ? " [" + t.type + "]" : ""}`);
      console.log(`  -- 正文: ${fr.text.replace(/\n/g, " ").slice(0, 300)}`);
    }
  }
  // 只断开 CDP 连接：窗口和页面留给下一个人（用户规则：别自动关窗）
  await detach(browser);
})().catch(e => { console.error("FAIL: " + (e && e.message || e)); process.exit(1); });
