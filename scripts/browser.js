// 常驻浏览器底座（web-forge 规范模板——复制到 webapps/<service>/lib/browser.js 使用）。
// 规则：不自动关窗；已有该站页面就复用，没有才新建；用户手关窗口后下次运行自动重拉。
// 实现：首次以 --remote-debugging-port 脱离进程拉起 Chrome（独立 user-data-dir，登录态存
// profile），之后所有动作 connectOverCDP 连同一实例；动作结束只 disconnect（close 对已连接
// 的 browser 仅断开连接），因此窗口继续活着。
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path");

// 登录态目录：站点目录下的 .auth（站点自己的会话不会串到别的站）；skill 脚本可经 env 指定
const AUTH = process.env.FORGE_AUTH_DIR || path.join(__dirname, "..", ".auth");
// 每站一个端口：共用同一个 Chrome 会让「先启动那站」的 context 设置（ignoreHTTPSErrors、
// 视口、语言）污染别的站（自签证书的站点会被别的站的 context 打死）。
// 同一站点仍复用自己的实例（窗口不关、页面复用）。
function portFor(key) { let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 9300 + (h % 400); }
const PORT = Number(process.env.FORGE_CDP_PORT || portFor(AUTH));
const CDP = `http://127.0.0.1:${PORT}`;
const PROFILE = path.join(AUTH, "profile");
const STATE = path.join(AUTH, "state.json"); // 旧版 storageState，仅首次建 profile 时注入一次

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tryConnect(chromium) {
  try { return await chromium.connectOverCDP(CDP); } catch { return null; }
}

async function ctxOf(browser, viewport) {
  return browser.contexts()[0]
    || browser.newContext({
      viewport: viewport || { width: 1440, height: 900 },
      locale: "zh-CN",
      // 全站忽略证书校验（用户 2026-11-03 规则）：内网/IP 直连/自签证书的站点否则直接
      // ERR_CERT_AUTHORITY_INVALID。代价是无法发现中间人——只对可信来源的站点用。
      ignoreHTTPSErrors: true,
    });
}

async function ensureBrowser(chromium, { viewport } = {}) {
  let browser = await tryConnect(chromium);
  if (browser) return { browser, ctx: await ctxOf(browser, viewport), launched: false };

  fs.mkdirSync(PROFILE, { recursive: true });
  const freshProfile = !fs.existsSync(path.join(PROFILE, "Default"));
  const child = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check",
    `--window-size=${(viewport && viewport.width) || 1440},${((viewport && viewport.height) || 900) + 120}`,
  ], { detached: true, stdio: "ignore" });
  child.unref();

  for (let i = 0; i < 80; i++) {
    await sleep(250);
    browser = await tryConnect(chromium);
    if (browser) {
      const ctx = await ctxOf(browser, viewport);
      if (freshProfile && fs.existsSync(STATE)) {
        try { await ctx.addCookies(JSON.parse(fs.readFileSync(STATE, "utf8")).cookies || []); } catch {}
      }
      return { browser, ctx, launched: true };
    }
  }
  throw new Error(`常驻浏览器启动失败（${CDP} 20s 未就绪）。可能 ${PROFILE} 被另一个 Chrome 占用`);
}

async function getPage(ctx, origin) {
  const pages = ctx.pages().filter(p => !p.isClosed());
  if (origin) {
    const hit = pages.find(p => { try { return new URL(p.url()).origin === new URL(origin).origin; } catch { return false; } });
    if (hit) return hit;
  }
  const blank = pages.find(p => p.url() === "about:blank");
  return blank || ctx.newPage();
}

async function saveState(ctx) {
  try { await ctx.storageState({ path: STATE }); } catch {}
}

async function detach(browser) {
  try { await browser.close(); } catch {} // 对 CDP 连接只断开，不 kill 我们 spawn 的 Chrome
}

module.exports = { ensureBrowser, getPage, saveState, detach, CDP, PROFILE, STATE };
