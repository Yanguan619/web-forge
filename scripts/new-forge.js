#!/usr/bin/env node
// new-forge —— 生成 webapps/<service>/ 骨架（底座 + 动作目录 + manifest 骨架 + .gitignore）。
// 用法: node <skill目录>/scripts/new-forge.js <service> <baseURL> [--dir <webapps根>]
//   service: 域名去协议去 www.、非法字符换下划线，如 example-com / 192_0_2_1
// 目的：底座只有这一份模板来源——不要手写第二份，也不要从别的站点复制（会带着别人的漂移）
const fs = require("fs");
const path = require("path");

const [service, baseURL] = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && arr[i - 1] !== "--dir");
const dirArg = (() => { const i = process.argv.indexOf("--dir"); return i >= 0 ? process.argv[i + 1] : "webapps"; })();

if (!service || !baseURL) {
  console.error("用法: node scripts/new-forge.js <service> <baseURL> [--dir <webapps根>]\n例: node scripts/new-forge.js example-com https://www.example.com");
  process.exit(2);
}

const root = path.resolve(process.cwd(), dirArg, service);
if (fs.existsSync(path.join(root, "manifest.md"))) {
  console.error(`已存在 ${root}/manifest.md —— 不覆盖既有 forge。要重建请先手动移走。`);
  process.exit(1);
}
const envKey = service.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_URL";

fs.mkdirSync(path.join(root, "lib"), { recursive: true });
fs.mkdirSync(path.join(root, "actions"), { recursive: true });
fs.mkdirSync(path.join(root, ".auth"), { recursive: true });

// 1) 常驻浏览器底座：直接复制模板（唯一真相源）
fs.copyFileSync(path.join(__dirname, "browser.js"), path.join(root, "lib", "browser.js"));

// 2) 站点底座
fs.writeFileSync(path.join(root, "lib", "context.js"), `// 站点底座：浏览器生命周期、baseURL、下拉赋值。动作脚本只调这三个 API。
const path = require("path");
const { createRequire } = require("module");
function loadPlaywright() { // 依赖从运行目录解析：按脚本自身目录找永远找不到消费项目的 node_modules
  try { return createRequire(path.join(process.cwd(), "index.js"))("playwright"); }
  catch { return require("playwright"); }
}
const { chromium } = loadPlaywright();
const { ensureBrowser, getPage, saveState, detach } = require("./browser");

const BASE = process.env.${envKey} || ${JSON.stringify(baseURL)};

async function open(route = "/") {
  const { browser, ctx } = await ensureBrowser(chromium, { viewport: { width: 1440, height: 900 } });
  const norm = u => u.split("?")[0].replace(/\\/+$/, "");
  const page = await getPage(ctx, BASE);
  const want = BASE.replace(/\\/+$/, "") + route;
  if (norm(page.url()) !== norm(want)) {
    await page.goto(want, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return { browser, ctx, page };
}

// 存会话 + 断开 CDP 连接（窗口不关；只连不断开会挂死 node 进程）
async function finish(ctx, browser) { await saveState(ctx); await detach(browser); }

// React 受控 <select>：locator.selectOption 会卡 actionability 30s，改 DOM 赋值 + 派发事件
async function setSelect(page, idx, target) {
  const res = await page.evaluate(({ idx, target }) => {
    const s = document.querySelectorAll("select")[idx];
    if (!s) return { ok: false, reason: "no-select" };
    const opts = [...s.options];
    const opt = opts.find(o => o.value === target) || opts.find(o => o.textContent.trim().includes(target));
    if (!opt) return { ok: false, reason: "no-option", options: opts.map(o => o.value).slice(0, 25) };
    s.value = opt.value;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value };
  }, { idx, target });
  if (!res.ok) throw new Error(\`select[\${idx}] 选不到 "\${target}": \${(res.options || []).join(", ")}\`);
  await page.waitForTimeout(700);
  return res.value;
}

module.exports = { open, finish, setSelect, BASE };
`);

// 4) 动作模板：登录（多数站点第一步）+ 通用抓取的骨架提示
fs.writeFileSync(path.join(root, "actions", "login.js"), `#!/usr/bin/env node
// login —— 有头窗口里人工登录（扫码/手机号/2FA），成功后会话留在 .auth/profile，所有动作共享。
// 凭据永不写进文件；自动化登录只在站点允许时用 env: LOGIN_USER / LOGIN_PASS。
const { open, finish } = require("../lib/context");

(async () => {
  const { browser, ctx, page } = await open("/login");
  try {
    console.log("浏览器已打开：请在弹出的窗口里完成登录，然后回到终端按回车");
    await new Promise(res => process.stdin.once("data", res));
    await page.waitForTimeout(800);
    const url = page.url();
    if (/login|signin|passport/i.test(url)) throw new Error(\`看起来还没登录成功（当前 \${url}），会话未保存\`);
    console.log("登录态已保存: .auth/profile");
  } catch (e) { console.error(e.message || e); process.exit(1); }
  finally { await finish(ctx, browser); }
})();
`);

// 5) manifest 骨架：路由清单与覆盖率表先留空，勘探后填
fs.writeFileSync(path.join(root, "manifest.md"), `# ${service} 动作清单（manifest）

> baseURL: ${baseURL}（\`${envKey}\` 可覆盖）· 固化: ${new Date().toISOString().slice(0, 10)} · 工具: playwright（有头强制）
> 浏览器: 常驻（不自动关窗；已有该站标签则复用）
> 登录: <未探测 / 不需要 / 跑 actions/login.js>

## 流程图（整站一张）
- <finalize 通过后再登记链接>

## 已固化（全部实测通过）
（尚无——先写 actions/extract.js 吃掉数据页，再封表单动作）

## 路由覆盖表（空白 = 欠账）
| 路由 | 覆盖方式 | 备注 |
|---|---|---|
| / | 待定 | |

## 冒烟
| 动作 | 参数 |
|---|---|
| login | |

## 已知限制 / 铁律（本站专有）
- 
`);

fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.auth/\n");
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
  name: service.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
  private: true,
  type: "commonjs",
}, null, 2) + "\n");

console.log(`已生成 ${root}`);
console.log("下一步:");
console.log(`  1. cd ${path.relative(process.cwd(), root) || "."} && npm i playwright && npx playwright install chromium`);
console.log(`  2. node <skill目录>/scripts/probe.js ${baseURL}   # 一次 dump 锚点`);
console.log("  3. 按 manifest 的路由覆盖表：先写 actions/extract.js，再封表单动作");
