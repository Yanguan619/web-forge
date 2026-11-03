# web-forge

把网页功能**固化**成可复用的 Playwright 脚本 + 动作清单，让任何 AI/任何人下次直接跑，
不必重新勘探页面。

核心判断：**AI 驾驶浏览器是贵、慢、脆的，确定性脚本重放是快、便宜、可审计的。**
所以勘探只做一次，把判断提取成代码，之后所有人重放。

> 交互式浏览器适合「研究」，本 skill 面向「生产」：要反复跑、要给别人复用、要进 CI 的动作。

## 为什么需要它

一个网页服务如果只部署了 Web（没有 API/CLI/MCP），它的完整功能面就在页面上。
手工让 AI 每次现点，成本按次计、结果不可复现；把页面动作固化成脚本后：

- 边际成本≈0，同一命令任何人跑结果一致；
- 有自检断言，页面改版时**大声失败**而不是默默点错位置；
- 产物是标准 Playwright 工程，不绑任何客户端，CI 里也能跑。

## 安装

把本目录放到你的 agent 的 skills 目录，例如：

```bash
# Claude Code / 兼容 agent
cp -r web-forge ~/.claude/skills/web-forge
# 或其它约定目录（如 ~/.agents/skills/web-forge）
```

依赖：Node 18+、`playwright`（在每个 forge 项目里装，脚本从运行目录解析）。

```bash
npm i playwright && npx playwright install chromium
```

## 快速开始

```bash
# 1) 生成一个站点的骨架（lib/ 底座 + actions/ + manifest 骨架 + .gitignore）
node scripts/new-forge.js example-com https://www.example.com

# 2) 进目录装依赖，然后勘探：一次 dump 全页锚点（testid/按钮/输入/表格/iframe/正文）
cd webapps/example-com && npm i playwright && npx playwright install chromium
node ../../scripts/probe.js https://www.example.com --out probe.json

# 3) 按 manifest 的路由覆盖表：先写通用 extract 吃掉数据页，再封表单动作
# 4) 每个动作真跑一遍，跑通的才登记；改动后回归：
node ../../scripts/smoke.js
```

消费已有 forge（最常见）：

```bash
# 读 manifest 找动作 → 跑
node webapps/<service>/actions/<verb>.js --help
node webapps/<service>/actions/<verb>.js <args>
```

## 目录

```
SKILL.md                 # 规则主干（无任何具体站点）
references/patterns.md   # 锚点回退层级 + 可复制的交互片段
references/cases.md      # 历史案例与实测数据（证据，不是规则）
scripts/probe.js         # 勘探：一次 dump 页面锚点全景
scripts/browser.js       # 常驻浏览器底座模板（唯一真相源）
scripts/new-forge.js     # 脚手架
scripts/smoke.js         # 按 manifest 冒烟表串行回归
```

一个 forge 的产物结构：

```
webapps/<service>/
  manifest.md          # 动作清单 + 路由覆盖表 + 冒烟表——别人的唯一入口
  lib/browser.js       # 常驻浏览器（窗口不关、复用标签）
  lib/context.js       # 站点底座：open / finish / setSelect
  actions/extract.js   # 通用抓取（先写它）
  actions/<verb>.js    # 一个动作一个薄命令
  .auth/               # 登录态（进 .gitignore）
  .archify/            # 整站一张功能流程图
```

## 关键设计

- **两态**：有 `manifest.md` 就消费（严禁重新勘探），没有就生产。
- **覆盖率闸门**：枚举路由，每行必须落到「动作」或通用 `extract`，空白格 = 欠账。
- **先 extract 后表单**：数据页共用一套解析，避免同一逻辑抄 N 遍。
- **一个动作一个文件**，动作之间禁止互相 require，底座只有一份模板。
- **一律有头**：站点看到的就是真人浏览器窗口，不需要 stealth/UA 伪造/代理池。
- **全站忽略证书校验**：内网/IP 直连/自签证书可用；代价是无法发现中间人，只对可信站点用。
- **常驻浏览器**：每站一个端口/一个窗口，不自动关窗、复用标签，只断开 CDP 连接。
- **冒烟回归**：一条命令知道哪个动作被改版打死，只重修那一个。

## 已知边界

- 有强验证码 / 需人工授权的站点，脚本只能做到该步停下并提示；
- 锚点靠文本与结构，改版会断——这是设计，断言负责发现它；
- 只适合「动作可枚举」的站点，不适合把整个站点语义化理解。

## License

MIT
