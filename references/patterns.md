# 交互模式（普适片段，与具体站点无关）

> SKILL.md 的补充层：锚点怎么选、交互怎么写。所有代码可直接复制，站点相关的部分用
> `<占位符>` 标出。具体站点的实测案例见 `cases.md`（证据，不是规则）。

## 锚点回退层级（可靠性从高到低）

1. **`data-testid`** —— 有就全用它；注意可能 **0 个**（大多数站点没有测试基建）。
2. **role + accessible name** —— `getByRole("button", { name: "登录" })`、`getByRole("menuitem")`。
   文案会变，但比 class 稳；多语言站要按当前 locale 匹配。
3. **结构类名 + 叶子元素顺序** —— SSR 站（Next.js/Nuxt + Tailwind）的典型形态：行容器用
   `a[href^="/<实体>/"]` 这类结构性选择器，行内字段用叶子元素的**类名 + DOM 顺序**。
   要点：先按类名特征分组，再按顺序取字段；名次/序号类字段常在榜首与榜尾用不同节点类型，
   必须准备回退（例如「取第一个短文本 span」）。
4. **旁侧标签文本（表单）** —— 无 label 的 input 按「closest(label) → 父级文本 →
   前兄弟文本」取标签，再按文本匹配。表单字段多时，先 dump 一次「序号 → 标签」映射。
5. **正文文本 / 表格解析（输出）** —— 结果面板按固定短语切（`<指标名>` 后跟数值），
   或把 `table` 的 `tr/td` 拉成二维数组。断言：解析不出就大声失败。
6. a11y snapshot / 截图 —— 只用于**人**判读，脚本里不依赖。

## 交互片段

```js
// 0) React 受控 <select>：locator.selectOption 可能卡 actionability 超时。
//    改用 DOM 赋值 + 派发 input/change；target 可给 option 的 value 或文本片段。
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
  if (!res.ok) throw new Error(`select[${idx}] 选不到 "${target}": ${(res.options || []).join(", ")}`);
  await page.waitForTimeout(700);
  return res.value;
}

// 1) 等就绪（代替固定 sleep）——SPA 水合 / 联动加载的通用做法
await page.waitForFunction(
  () => document.querySelectorAll("select").length >= 3
    && document.querySelectorAll("select")[0].options.length > 1,
  null, { timeout: 60000 });

// 2) 选择交互带重试（水合竞态可能吞掉第一次选择）
async function pickWithRetry(sel, idx, value, waitMs) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sel.nth(idx).selectOption(value);
    try {
      return await page.waitForFunction(
        (i) => document.querySelectorAll("select")[i]?.options.length > 1, idx + 1, { timeout: waitMs / 3 });
    } catch { if (attempt === 3) throw new Error(`选 "${value}" 后下游 ${waitMs / 1000}s 未加载`); }
  }
}

// 3) 表格导出（空壳表是图表占位，过滤掉）
const tables = await page.evaluate((limit) => [...document.querySelectorAll("table")]
  .map((t, index) => {
    const all = [...t.querySelectorAll("tr")].map(tr => [...tr.querySelectorAll("th,td")].map(c => c.innerText.trim()));
    const hasHeader = !!t.querySelector("thead th, tr th");
    return { index, headers: hasHeader ? all[0] : [], rows: (hasHeader ? all.slice(1) : all).slice(0, limit) };
  })
  .filter(t => t.rows.some(r => r.some(c => c))), 20);

// 4) 流式输出完成判定（无完成事件：末条文本稳定 + 跳转空轮次容错）
async function waitStableText(page, containerSel, stableMs = 1500) {
  const snap = async () => {
    try { return (await page.locator(containerSel).last().allInnerTexts()).join("\n"); }
    catch { return ""; }   // 页面跳转瞬间执行上下文销毁，吞掉空轮次
  };
  let prev = null, since = Date.now();
  while (true) {
    const cur = await snap();
    if (cur !== prev) { prev = cur; since = Date.now(); }
    else if (cur && Date.now() - since > stableMs) return cur;
    await page.waitForTimeout(300);
  }
}

// 5) 文件上传：原生 file chooser 用事件等；隐藏 input 直接 setInputFiles
const fcP = page.waitForEvent("filechooser");   // 点上传按钮前先挂监听
await page.getByRole("button", { name: /上传/ }).click();
await (await fcP).setFiles("C:/path/to/file.csv");
```

## 控件语义一次性 dump（写动作之前先跑这个）

```js
// 一次拿到页面上所有交互控件的「可用参数」：下拉的 value/全部选项、输入框的类型与标签、
// 按钮的文案与禁用态。option 的 value 常自带语义，可直接作为动作参数。
const form = await page.evaluate(() => {
  const labelOf = el => {
    const l = el.closest("label") || (el.id && document.querySelector(`label[for="${el.id}"]`));
    return (l?.innerText || el.getAttribute("aria-label") || el.previousElementSibling?.innerText || "")
      .trim().replace(/\s+/g, " ").slice(0, 40);
  };
  return {
    selects: [...document.querySelectorAll("select")].map((s, i) => ({
      i, label: labelOf(s), value: s.value,
      options: [...s.options].map(o => ({ v: o.value, t: o.textContent.trim() })).slice(0, 40),
    })),
    inputs: [...document.querySelectorAll("input, textarea")].map((el, i) => ({
      i, tag: el.tagName.toLowerCase(), type: el.type || undefined,
      name: el.name || undefined, placeholder: el.placeholder || undefined,
      label: labelOf(el), value: el.value || undefined,
    })),
    buttons: [...document.querySelectorAll("button, [role=button]")]
      .map(b => ({ t: b.innerText.trim().replace(/\s+/g, " ").slice(0, 30), disabled: b.disabled }))
      .filter(b => b.t),
  };
});
```

## 上下文选项速查

- `ignoreHTTPSErrors: true` —— 全站开启（IP 直连/内网/自签证书站点否则直接报证书错）。
- `locale` + 固定 viewport —— 减少渲染差异；多语言站要在 URL 或菜单里先把语言定住。
- `storageState` —— 登录后 `ctx.storageState({ path })` 落盘；匿名访客也有 cookie 身份，
  照样值得存（否则每次都是新访客，历史/配额全丢）。
- **一律有头**：所有底座 `headless: false`。无头只在用户当次明确要求时临时用。
