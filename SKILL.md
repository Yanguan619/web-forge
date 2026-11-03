---
name: web-forge
description: >
  网页功能固化与自动化复用（web automation forging）。两种场景必须触发：
  (1) 用户想让 AI 自动化操作某个网页/web 服务、复用某网站的功能、把某个页面的功能
  封装成脚本或工具（哪怕只说「帮我操作那个控制台/后台/页面」）；
  (2) 用户给出一个 URL，要求识别/梳理页面功能、录制网页操作、生成 Playwright
  自动化脚本、把功能「固化」下来给别人用。
  工作方式：先查当前项目 webapps/<service>/manifest.md——存在则直接读 manifest
  选动作、填参数、跑脚本（消费模式，不重新勘探）；不存在则进入生产模式：枚举路由 →
  用浏览器勘探 → 固化为参数化 Playwright 脚本 + manifest 动作清单。
  产物可被任何 AI/任何人复用，后续再升格 MCP。
  触发词：网页自动化、固化页面功能、录制操作、web automation、page automation、
  playwright 脚本、操作那个页面、复用这个网站的功能、无 testid 站点、iframe 壳站、
  导出榜单/表格数据、批量填表、把网页变成 API。
  不适用：抓取静态页面内容（web-scraper）、测试自家 web 应用质量（webapp-testing）、
  只读文档页（webfetch 即可）。
---

# Web Forge — 网页功能固化与复用

> 本文件只写**普适规则**，不含任何具体站点。站点实例、实测数据与踩坑记录属于证据，
> 放在 `references/cases.md`，读规则时不必读它。

## 核心思想

**一次勘探，终身重放。** AI 驾驶浏览器是贵、慢、脆的；确定性脚本重放是快、便宜、
可审计的。本 skill 把前者的成本压成一次，把后者变成资产。

产物永远只有两层，不多造：

- **脚本（给机器跑）**：参数化的 Playwright 代码，`node` 直接执行；
- **manifest（给 AI 读）**：动作清单 + 路由覆盖表——**其他 AI/会话读它即可复用**。

## 什么时候**不**该用本 skill

| 场景 | 正确做法 |
|---|---|
| 只跑一次、或目标站正在改版、或流程还没摸清 | **交互式**（浏览器 MCP / CLI 现场看 DOM），别固化 |
| 要抓的是静态页面正文 | webfetch / 静态抓取工具 |
| 要测的是自家 web 应用的质量 | 应用测试工具，不是本 skill |
| 站点有官方 API | 直接调 API；MCP 包装优先于浏览器自动化 |

判据一句话：**interactive 是「研究」，forge 是「生产」**。只有要反复跑、要给别人复用、
要进 CI 的动作，才值得付固化成本（数据页 ≈10 分钟，带表单动作 30–60 分钟）。
勘探期本来就用交互式浏览器——两者是同一条流水线的两段，不是二选一。

## 第 0 步：两态判定

service 名 = 域名去协议去 `www.`，非法字符换下划线。先查 `webapps/<service>/manifest.md`：

- **存在** → 消费模式；**严禁重新勘探**。
- **不存在** → 生产模式；先跑脚手架：

```bash
node <skill目录>/scripts/new-forge.js <service> <baseURL>
# 生成 webapps/<service>/{lib/browser.js, lib/context.js, actions/login.js, manifest.md, .gitignore}
# 底座是模板的唯一副本来源，别手写第二份
```

## 消费模式（5 行上手）

1. 读 `webapps/<service>/manifest.md` 的**路由覆盖表** → 找对应动作；
2. 拿不准参数值先跑 `--options`（列出真实的厂商/型号/档位 value）；
3. 跑：`node webapps/<service>/actions/<verb>.js <参数>`（用 `__dirname` 解析依赖，任意 cwd 可跑）；
4. 断言炸了 = 页面改版 → **只对那一个动作**回生产模式重勘探并更新 manifest，别动能跑的；
5. 结果在 stdout（或 `--out <file>` 落盘的 JSON），报给用户。

## 生产模式（5 步，第 4 步是覆盖率闸门）

### 1. 枚举路由（先地图，后走路）

导航链接 + hash 路由 + 页面内 tab + 页脚/sitemap，列成**路由清单**。hash 路由
（`#route`）与子路径是同一站点的多页面，不拆成多个 forge。

### 2. 勘探

- **快路径**：`node <skill目录>/scripts/probe.js <url> [--wait ms] [--out file.json]`
  → 一次 dump 可见 testid、按钮/链接/输入、表格、canvas、iframe（逐帧下钻）+ 正文首屏，
  同时连上该站点的常驻浏览器（不另开窗口、不丢登录态）。探针依赖从**运行目录**解析——
  在装了 playwright 的 `webapps/<service>` 里跑。
- **表单类页面要一轮 dump 控件语义**：每个 `select` 的 value/选项、每个 `input` 的
  type 与占位、每个按钮的文案与禁用态。只 dump 一次，别写第二个探测脚本。
- 语义判断靠 AI（这按钮是「回滚」还是「重置」），定位靠 a11y 快照/锚点，不靠截图猜像素。
- **登录门控**：访客与登录态各探一遍，门控本身就是功能属性（manifest 标注「需登录」）。
- 每个候选动作记五件事：入口路由、操作路径、输入参数、前置条件、怎么判断成功。

#### 先分型，再动手（决定第一个动作，能省掉一半试错）

| 页面类型 | 一眼识别 | 第一步 | 已知坑 |
|---|---|---|---|
| 数据型 | 表格 / 重复行 / 长列表 | 通用 `extract` | 图表占位空壳、虚拟滚动只渲染可见行、分页要翻 |
| 表单型 | `<select>` / 数字输入 / 提交按钮 | 先 dump 控件语义 → `setSelect` | 受控组件卡 actionability、联动异步、默认值非空 |
| 状态机型 | 分步文案（`STEP n/N`）、「下一步」 | 逐步枚举选项 → 参数化成序号 | 状态在框架内存里、选项列表混入导航按钮 |
| 壳型 | `<iframe>` / 导航之外一片空白 | 直连内嵌 URL | 尾斜杠敏感、跨域帧不能 evaluate |
| 会话型 | 输入框 + 消息/结果列表 | 等「文本稳定」 | 流式无完成事件、跳转瞬间销毁执行上下文 |

- 判断顺序固定：**路由与壳 → 有无 testid → 数据结构（table / 重复行）→ 交互控件清单**。
  四步看完再写代码；顺序颠倒就会先写解析再发现是壳站。
- **一轮 dump 拿全控件语义**：`select` 的 value + 全部 options、`input` 的 type/name/placeholder
  与所在标签、`button` 的文案 + 是否 disabled。option 的 value 常自带语义
  （如 `vendor-model-slug`），可以直接当动作参数，省一层映射。
- **联动链用「改上游看下游」确定**：选 A 后 B 的 options 变了 = 依赖关系，别猜。
- 结果优先读 DOM（table / 文本），不读截图；若页面结构复杂但 Network 里有该站自己用的
  JSON 接口，读接口比解析 DOM 更稳（抗改版）——先确认它不是打点/埋点请求。
- **止损线**：单个页面超过 45 分钟还没跑通，停下来重估——是锚点难，还是这动作根本不该固化
  （只跑一次就该走交互式）。继续磨的成本通常已经超过它的价值。

### 3. 固化（顺序决定速度）

**先写通用 `extract`，再封表单动作。** 数据页（榜单/价格/详情/筛选态）用同一个
通用抓取器吃掉（`--route` + `--tab-index` + `--search`），别一个路由抄一遍解析；
之后再封「有交互」的动作（选下拉、填数字、点对比、走向导）。

目录（脚手架已生成，别自己另建）：

```
webapps/<service>/
  manifest.md          # 动作清单 + 路由覆盖表——别人的唯一入口
  lib/browser.js       # 常驻浏览器（模板副本，改动需全站同步）
  lib/context.js       # 站点底座：open/finish/setSelect
  actions/extract.js   # 通用抓取（先写它）
  actions/<verb>.js    # 一个动作一个薄命令
  .auth/               # 登录态（profile 目录 + state.json），进 .gitignore
  .archify/            # 整站一张流程图
```

**底座契约（动作只许用这三个 API，别碰浏览器生命周期）**：

| API | 作用 |
|---|---|
| `open(route?)` | 连常驻浏览器、复用同站标签、导航到 route，返回 `{browser, ctx, page}` |
| `finish(ctx, browser)` | 存会话 + **断开 CDP 连接**（`browser.close()` 对已连接实例只断开，窗口存活） |
| `setSelect(page, i, target)` | React 受控 `<select>` 赋值（DOM + 派发 input/change），`target` 给 value 或文本片段 |

旧 forge 若没导出 `setSelect`，按同一实现补进那一站的 `lib/context.js`，别在动作文件里另写。

常驻浏览器（`lib/browser.js`）三条要点：**不自动关窗**（`--remote-debugging-port` +
独立 user-data-dir 脱离进程拉起，之后 connectOverCDP 连同一实例）；**有同站标签就复用**、
没有才新建；**只连不断开会让 node 挂死**，所以 `finish()` 必须断开。

### 4. 覆盖率闸门（做完才算完）

对着路由清单逐条核对，每行必须落到「动作」或「通用 extract」：

| 路由 | 覆盖方式 | 备注 |
|---|---|---|
| /<数据页> | extract | 搜索框 + 排序未封 |
| /<表单页> | <verb> | 双实体对比 |

- 空白格 = 欠账，**不许留「知道有但没管」**；
- 只出现在弹窗面板里、不在 URL 里的功能，从 probe 的按钮清单补进表里，标「面板类」；
- 全量是目标，但**跑通的才进 manifest**——没验证的动作登记出去，等于让每个使用者陪葬一次。

### 5. 验证与登记

- 每个动作**真跑一遍（有头）**，失败就修锚点再跑；成功样例贴进 manifest。
- 跳不过的人工步骤（2FA/验证码）：脚本在该步停下并明确提示，manifest 标「需人工」。
- 登记：动作名、参数、运行示例、成功判定、日期。
- **登记冒烟表**（`## 冒烟`，每行「动作 + 最小真实参数」），之后一条命令做全量回归：

```bash
node <skill目录>/scripts/smoke.js            # 在站点目录跑；串行、带超时、失败 exit 1
node <skill目录>/scripts/smoke.js --only <action>
```

改版后先跑冒烟：**谁红就只重勘探谁**，这就是「只修一个动作」从口号变成可执行动作的地方。

## 动作脚本契约（复制着写，别即兴发挥）

```js
#!/usr/bin/env node
// <verb> —— <一句话>。参数见 manifest.md。
const { open, finish, setSelect } = require("../lib/context");
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
// 命令行开关必须跳过，别混进业务参数（--json/--out 漏进 prompt 会被模型当成问题内容）
const outFile = val("--out");

(async () => {
  const { browser, ctx, page } = await open("/<入口路由>");
  try {
    // 1) 自检：入口还在不在（页面改版在这里大声失败）
    await page.waitForSelector("<行容器选择器>", { timeout: 15000 });
    // 2) 主体：锚点优先级 data-testid > role+name > 结构类名+叶子顺序 > 文本
    // 3) 中文参数不可靠（PowerShell→node 会乱码）：参数用 value / 序号，
    //    中文只在 page.evaluate 内部匹配
    const data = await page.evaluate(() => ({ /* ... */ }));
    const payload = JSON.stringify(data);
    if (outFile) require("fs").writeFileSync(outFile, payload, "utf8"); // 落文件才是干净 UTF-8
    console.log(payload);          // stdout 只放数据
  } catch (e) { console.error(e); process.exit(1); }
  finally { await finish(ctx, browser); }   // 存会话 + 断开连接，窗口不关
})();
```

输出约定：stdout = 数据（一行 JSON，人/AI/管道三用）；stderr = 过程信息；失败时
stderr 带「判定 + 指引」（哪个锚点找不到、下一步怎么办）。

**动作接口契约**（消费方靠它试错，别省）：

| 参数 | 要求 |
|---|---|
| `--options` | 有取值枚举的动作必须有：输出合法 value + 文本（实体/型号/档位）。manifest 写了 `--model X` 却没处查 X 的合法值，等于没写 |
| `--out <file>` | 结果落 UTF-8 文件；中文参数或控制台 GBK 环境下这是唯一干净路径 |
| `--limit` | 列表类动作必须有上限，默认别超过 50 |
| `--smoke` | 可选；更推荐把最小用例写进 manifest 的**冒烟表**（见上） |

## manifest 模板

```md
# <service> 动作清单（manifest）

> baseURL: https://…（SERVICE_URL 可覆盖）· 固化: <YYYY-MM-DD> · 工具: playwright（有头强制）
> 浏览器: 常驻（不自动关窗；已有该站标签则复用）
> 登录: <是否需要 / 怎么获得>

## 流程图（整站一张）
- [<service>.html](.archify/<folder>/<service>.html) — <一句话说图里是什么>

## 已固化（全部实测通过）
### <verb> —— <一句话>
- 参数: `[...]`
- 运行: `node actions/<verb>.js <示例>`
- 输出: ...
- 成功: ...

## 路由覆盖表
| 路由 | 覆盖方式 | 备注 |

## 冒烟
| 动作 | 参数 |

## 已知限制 / 铁律（本站专有）
```

## 流程图（一个站点一张，易漏项）

用 archify skill 产出（workflow 类型、zh-CN；多 URL 不拆文件，画成图内分支/泳道）。
**每次新增或删除动作都要重新 `finalize` 那张图**——图落后于清单等于给别人一张错地图。
画法：每个动作作为「选动作」阶段的入口节点，汇入共用主干（打开 → 等就绪 → 提取 → 输出），
一眼看出「N 个动作共用一条流水线」。

archify workflow 两条硬约束（能省两轮返工）：`col` 只能 0–5（`phases` 的
fromCol/toCol 同理）；同一 `lane + col` 只能放一个节点（两个会报 `node-overlap`）。
动作多时用「多动作泳道 × 列」摊开。

## 铁律（按类分组）

**浏览器 / 会话**
- **只使用有头，不存在 headless**。
- **全站忽略证书校验**：所有 context 统一 `ignoreHTTPSErrors: true`——IP 直连、内网、
  自签证书的站点否则直接 `ERR_CERT_AUTHORITY_INVALID`。代价是**无法发现中间人**：
  只对可信来源的站点用。
- **auth 永不固化**：凭据走 env，会话走 profile/storageState，`.auth/` 进 .gitignore。
- **只连不断开会挂死**：`finish()` 必须断开 CDP 连接；窗口照留。
- **每站一个端口 = 每站一个常驻窗口**（端口由站点目录哈希得出，`FORGE_CDP_PORT` 可覆盖）。
  共用同一个浏览器实例时，先启动那站的 context 设置（证书/视口/语言）会污染别的站。
- **进程会堆积，定期清**（「窗口不关」的代价）：同站正常只有 1 个窗口，看到一串就是历史
  残留（端口/profile 被占，新实例起不来 → 表现为 20s 超时）。清理时只杀命令行含
  `.auth\profile` 的 chrome 进程，别碰用户自己的浏览器。

**锚点**
- **无 testid 站是常态**：回退层级 = role+name → 结构类名与叶子顺序 → 旁侧标签 →
  正文/表格解析（见 `references/patterns.md`）。
- **testid 会同名多元素**（同一 testid 出现在多个状态节点上）：裸 testid 会 strict-mode
  炸或点错，加 nth 或锚到更具体的容器。
- **`goto("/")` 会吃掉 baseURL 的路径段**：goto 完整地址，再断言 `page.url()`。
- **iframe 壳站**：功能常以 `<iframe src="/<route>/?embed=1">` 嵌入，直接访问内嵌 URL；
  内嵌路由尾斜杠敏感。

**交互**
- **富文本编辑器禁 `keyboard.insertText`**：合成事件被编辑器模型丢弃（DOM 有字、实际
  提交空/脏），用 `fill()`。
- **React 受控 `<select>` 用 `selectOption` 会卡 actionability 超时**：用底座 `setSelect`
  （DOM 赋值 + 派发 input/change）。
- **SPA 水合竞态**：交互前等「就绪信号」（目标元素/选项出现），固定 sleep 会被水合冲掉；
  下拉类交互带重试。
- **多步向导**：状态在框架内存里，先 `reload()` 才能从第 1 步开始；步数从页面文本
  `STEP n/N` 读；选项过滤掉「上一步/下一步」。
- **流式输出没有完成事件**：末条文本稳定 N ms 即视为完成；发送后跳转瞬间上下文销毁的
  空轮次要吞掉。

**产物 / 维护**
- **一个动作一个文件，底座只有一份**：各自开浏览器、各自取登录态的脚本必然漂移。
- **动作之间禁止互相 require**：只依赖 `lib/` + 标准库；要共享就下沉到 `lib/`。
- **底座模板只有 `scripts/browser.js` 一份**：各站 `lib/browser.js` 是副本，改模板后
  必须同步全站（用脚本批量替换 + 逐站 `node --check`）。
- **自检断言是契约**：它炸了 = 页面改版，只重勘探那一个动作。
- **数据要断言非空、不许把空壳当结果**：图表占位空表很常见。解析后断言「行数 ≥ N 且
  至少一列非空」，否则报「数据为空 = 改版或未加载」，别静默输出 `[]` 让下游当真。
- **一律有头就够，不要额外伪装**：站点看到的就是一个真人浏览器窗口——不需要 stealth 插件、
  UA 伪造、指纹随机化、代理池。这些只会增加不确定性和维护成本。同理**不做反爬对抗**：
  如果页面因为身份/权限拿不到，那是登录门控（跑一次 login），不是反爬问题。
- **动作串行执行**：常驻窗口是本体，并发跑同一站只会互相抢标签页，没有收益。
- **上传/下载有专门做法**：上传用 `setInputFiles`（别模拟点开系统文件对话框，无法自动化）；
  下载用 `page.waitForEvent("download")` + `download.saveAs(...)`，目录进 `.gitignore`；
  「下载完成」没有通用信号，只能等文件大小稳定两次采样。
- **别造没人要的产物**：不要截图存档、不要执行日志库、不要「通用页面理解框架」。

## 升格 MCP

动作稳定、且要跨项目/给 subagent 高频复用时，把 manifest 一比一映射成 MCP 工具
（mcp-builder）——MCP 本质就是「带类型和描述的脚本」。在那之前，skill + 脚本目录
已是完整可分发的形态（标准 Playwright 工程，CI 也能跑）。

## 参考层

- `references/patterns.md` — 锚点回退层级与可复制的交互片段（普适，无站点）
- `references/cases.md` — 历史案例与实测数据（**证据，不是规则**，可按需读或删）
- `scripts/probe.js` — 一次 dump 全页锚点（连该站常驻浏览器，不另开窗口）
- `scripts/browser.js` — 常驻浏览器底座模板（唯一真相源）
- `scripts/new-forge.js` — 脚手架：一次生成 lib/ + actions/login.js + manifest 骨架
- `scripts/smoke.js` — 按 manifest 冒烟表串行回归，一条命令知道哪个动作被改版打死
