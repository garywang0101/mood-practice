import {
  blankRow,
  exampleValues,
  fieldsHTML,
  formHTML,
  hasContent,
  isRowEmpty,
  readFields,
  readForm,
  rowHTML,
  validateNumbers,
  viewHTML,
} from "./form.js";
import {
  deleteEntry,
  emptyState,
  exportPayload,
  getEntry,
  listEntries,
  load,
  loadSettings,
  parseImport,
  save,
  saveSettings,
  upsertEntry,
  writeState,
} from "./store.js";
import {
  addDays,
  asNumber,
  clip,
  esc,
  formatDayLabel,
  formatStamp,
  shortLabel,
  todayIso,
  uid,
} from "./util.js";

const DATA_URL = new URL("../worksheets.json", import.meta.url);
const TOTAL_MS = 180000;
const CHART_DAYS_KEY = "chart-days";

let pack = null;
let seed = null;
let modalResolver = null;
let toastTimer = 0;
const ui = { chartDays: 7 };
const timer = {
  running: false,
  done: false,
  startedAt: 0,
  elapsed: 0,
  lastPhase: -1,
  phases: [],
  total: TOTAL_MS,
  finishedChimed: false,
};
let wakeLock = null;

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  home: svg('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>'),
  check: svg('<path d="M8 4h8a2 2 0 0 1 2 2v14l-6-3-6 3V6a2 2 0 0 1 2-2z"/>'),
  plan: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
  about: svg('<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>'),
  auto: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>'),
};

function worksheets() {
  return pack?.worksheets || [];
}

function getWs(id) {
  return worksheets().find((worksheet) => worksheet.id === id) || null;
}

function parseRoute() {
  const parts = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "sos") return { name: "sos" };
  if (parts[0] === "plan") return { name: "plan" };
  if (parts[0] === "about") return { name: "about" };
  if (parts[0] === "w" && parts[1]) {
    if (!parts[2]) return { name: "sheet", id: parts[1], mode: "list" };
    if (parts[2] === "new") return { name: "sheet", id: parts[1], mode: "edit", entryId: null };
    return {
      name: "sheet",
      id: parts[1],
      entryId: parts[2],
      mode: parts[3] === "edit" ? "edit" : "view",
    };
  }
  return { name: "home" };
}

function sheetPath(id, ...rest) {
  return `#/w/${[id, ...rest].map(encodeURIComponent).join("/")}`;
}

function applyTheme(theme) {
  const dark = theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.applied = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#1a1815" : "#f3efe6");
}

function themeIcon(theme) {
  if (theme === "light") return ICON.sun;
  if (theme === "dark") return ICON.moon;
  return ICON.auto;
}

function themeLabel(theme) {
  if (theme === "light") return "当前浅色，点按切换颜色";
  if (theme === "dark") return "当前深色，点按切换颜色";
  return "当前跟随系统，点按切换颜色";
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function hotlinesHTML() {
  return `<ul class="hotlines">
    <li><a href="tel:01082951332">北京心理危机研究与干预中心 010-82951332</a></li>
    <li><a href="tel:4001619995">全国心理援助热线 400-161-9995</a></li>
  </ul>`;
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function closeModal(result) {
  const modal = document.getElementById("modal");
  modal.hidden = true;
  modal.innerHTML = "";
  if (modalResolver) {
    const resolve = modalResolver;
    modalResolver = null;
    resolve(result);
  }
}

function confirmDialog({ title, body, confirmText, danger }) {
  closeModal(false);
  return new Promise((resolve) => {
    modalResolver = resolve;
    const modal = document.getElementById("modal");
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${esc(title)}</h2>
      <p>${esc(body)}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-cancel>取消</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>
      </div>
    </div>`;
    modal.querySelector("[data-cancel]").focus();
  });
}

function tabFor(route) {
  if (route.name === "home") return "home";
  if (route.name === "plan") return "plan";
  if (route.name === "about") return "about";
  if (route.name === "sheet" && route.id === "daily_checkin") return "checkin";
  if (route.name === "sheet" && route.id === "eight_week_plan") return "plan";
  return "";
}

function shell({ tab, title, back, content }) {
  document.title = title === "情绪练习" ? title : `${title} · 情绪练习`;
  const settings = loadSettings();
  const left = back
    ? `<a class="back" href="${esc(back)}">返回</a>`
    : `<span class="brand-mark" aria-hidden="true"></span>`;
  return `<header class="topbar">
    <div class="topbar-inner">
      ${left}
      <h1>${esc(title)}</h1>
      <button type="button" class="icon-btn" data-action="cycle-theme" aria-label="${esc(themeLabel(settings.theme))}">${themeIcon(settings.theme)}</button>
    </div>
    <p class="privacy">记录只保存在这台设备上</p>
  </header>
  <main class="wrap">${content}</main>
  <nav class="tabbar" aria-label="主导航">
    <div class="tabbar-inner">
      ${tabLink("#/", "home", tab, ICON.home, "首页")}
      ${tabLink("#/w/daily_checkin", "checkin", tab, ICON.check, "打卡")}
      ${tabLink("#/plan", "plan", tab, ICON.plan, "计划")}
      ${tabLink("#/about", "about", tab, ICON.about, "关于")}
    </div>
  </nav>`;
}

function tabLink(href, id, current, icon, label) {
  const currentAttr = id === current ? ' aria-current="page"' : "";
  return `<a href="${href}"${currentAttr}>${icon}<span>${label}</span></a>`;
}

function guidanceHTML(worksheet) {
  return `<div class="callout">
    <p><span class="k">什么时候用</span>${esc(worksheet.when_to_use)}</p>
    <p><span class="k">怎么填</span>${esc(worksheet.how_to_fill)}</p>
  </div>`;
}

function sourcesHTML(sources) {
  if (!sources?.length) return "";
  const items = sources
    .map((source) => `<li>${esc(source.book)} · ${esc(source.chapter)}${source.note ? ` · ${esc(source.note)}` : ""}</li>`)
    .join("");
  return `<details class="sources"><summary>来源</summary><ul>${items}</ul></details>`;
}

function referenceHTML(reference) {
  if (!reference) return "";
  const items = reference.items.map((item) => `<li>${esc(item)}</li>`).join("");
  return `<details class="ref"><summary>${esc(reference.title)}</summary><ol>${items}</ol></details>`;
}

function stepsHTML(steps) {
  if (!steps?.length) return "";
  return steps
    .map(
      (step) => `<section class="block steps"><h2>${esc(step.title)}</h2><ol>${step.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></section>`,
    )
    .join("");
}

function safetyHTML(worksheet) {
  if (!worksheet.safety_note) return "";
  return `<div class="safety"><p>${esc(worksheet.safety_note)}</p>${hotlinesHTML()}</div>`;
}

function scoreSection(worksheet) {
  return (worksheet.sections || []).find((section) =>
    section.fields.some((field) => field.type === "number" && field.min === 0 && field.max === 10),
  );
}

function scoreFields(worksheet) {
  const section = scoreSection(worksheet);
  if (!section) return [];
  return section.fields.filter((field) => field.type === "number" && field.min === 0 && field.max === 10);
}

function collectScoreRows(worksheet, entries) {
  const section = scoreSection(worksheet);
  const fields = scoreFields(worksheet);
  const dateField = section?.fields.find((field) => field.type === "date");
  if (!section || !dateField || !fields.length) return { fields, rows: [] };
  const byDate = new Map();
  for (const entry of entries) {
    const source = entry.values?.[section.id];
    const rows = section.repeatable ? source || [] : [source || {}];
    for (const row of rows) {
      const date = row?.[dateField.name];
      if (!date) continue;
      const prev = byDate.get(date);
      if (prev && prev.updatedAt > entry.updatedAt) continue;
      const point = { date, updatedAt: entry.updatedAt };
      for (const field of fields) point[field.name] = asNumber(row?.[field.name]);
      byDate.set(date, point);
    }
  }
  return {
    fields,
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function findEntryForDate(worksheet, date) {
  const section = scoreSection(worksheet);
  const dateField = section?.fields.find((field) => field.type === "date");
  if (!section || !dateField) return null;
  let best = null;
  for (const entry of listEntries(load(), worksheet.id)) {
    const source = entry.values?.[section.id];
    const rows = section.repeatable ? source || [] : [source || {}];
    if (!rows.some((row) => row?.[dateField.name] === date)) continue;
    if (!best || entry.updatedAt > best.updatedAt) best = entry;
  }
  return best;
}

function chartWindow(rows, days) {
  const end = new Date(`${todayIso()}T00:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return {
    start,
    end,
    rows: rows.filter((row) => {
      const time = new Date(`${row.date}T00:00:00`);
      return time >= start && time <= end;
    }),
  };
}

function chartSVG(fields, rows, start, end) {
  const width = 360;
  const height = 196;
  const left = 28;
  const right = 8;
  const top = 12;
  const bottom = 28;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const xFor = (date) => {
    const t0 = start.getTime();
    const t1 = end.getTime();
    const t = new Date(`${date}T00:00:00`).getTime();
    if (t1 === t0) return left + innerW / 2;
    return left + ((t - t0) / (t1 - t0)) * innerW;
  };
  const yFor = (value) => top + innerH - (value / 10) * innerH;
  const classes = ["mood", "irrit", "anx"];
  const grids = [0, 5, 10]
    .map((tick) => {
      const y = yFor(tick);
      return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-label" x="2" y="${y + 4}">${tick}</text>`;
    })
    .join("");
  const lines = fields
    .map((field, index) => {
      const klass = classes[index % classes.length];
      const points = rows
        .filter((row) => row[field.name] != null)
        .map((row) => `${xFor(row.date)},${yFor(row[field.name])}`);
      const line = points.length > 1 ? `<polyline class="chart-line ${klass}-line" points="${points.join(" ")}"></polyline>` : "";
      const dots = rows
        .filter((row) => row[field.name] != null)
        .map((row) => `<circle class="${klass}-dot" cx="${xFor(row.date)}" cy="${yFor(row[field.name])}" r="3.5"></circle>`)
        .join("");
      return line + dots;
    })
    .join("");
  const labelCount = Math.round((end - start) / 86400000) <= 7 ? 7 : 5;
  const labels = [];
  for (let i = 0; i < labelCount; i += 1) {
    const ratio = labelCount === 1 ? 0 : i / (labelCount - 1);
    const time = new Date(start.getTime() + (end.getTime() - start.getTime()) * ratio);
    const iso = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")}`;
    const x = xFor(iso);
    labels.push(`<text class="chart-label" x="${x}" y="${height - 8}" text-anchor="middle">${time.getMonth() + 1}/${time.getDate()}</text>`);
  }
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="情绪分数趋势">${grids}${lines}${labels.join("")}</svg>`;
}

function chartTable(fields, rows) {
  if (!rows.length) return "";
  const head = fields.map((field) => `<th>${esc(shortLabel(field.label))}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = fields
        .map((field) => `<td>${row[field.name] == null ? "—" : esc(row[field.name])}</td>`)
        .join("");
      return `<tr><th>${esc(row.date.slice(5))}</th>${cells}</tr>`;
    })
    .join("");
  return `<table class="sr-only"><caption>近日分数</caption><thead><tr><th>日期</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function chartBlock(worksheet) {
  const { fields, rows: allRows } = collectScoreRows(worksheet, listEntries(load(), worksheet.id));
  const days = ui.chartDays === 30 ? 30 : 7;
  const { start, end, rows } = chartWindow(allRows, days);
  const legend = fields
    .map((field, index) => {
      const klass = ["mood", "irrit", "anx"][index % 3];
      return `<span><i class="${klass}-dot"></i>${esc(shortLabel(field.label))}</span>`;
    })
    .join("");
  const caption = fields.map((field) => field.label).join("；");
  const empty = rows.length
    ? ""
    : `<p>这 ${days} 天还没有分数。记下一两天之后，这里会连成线。某一天高低都没关系。</p>`;
  const recorded = rows.filter((row) => fields.some((field) => row[field.name] != null)).length;
  const summary = rows.length ? `<p class="small muted">这 ${days} 天里有 ${recorded} 天记了分数。</p>` : "";
  return `<div class="seg" role="group" aria-label="趋势范围">
      <button type="button" class="btn btn-secondary" data-action="chart-range" data-days="7" aria-pressed="${days === 7}">7 天</button>
      <button type="button" class="btn btn-secondary" data-action="chart-range" data-days="30" aria-pressed="${days === 30}">30 天</button>
    </div>
    ${empty}
    ${rows.length ? chartSVG(fields, rows, start, end) : ""}
    ${rows.length ? `<div class="legend">${legend}</div>` : ""}
    <p class="small muted">${esc(caption)}</p>
    ${summary}
    ${chartTable(fields, rows)}`;
}

function entryWhen(worksheet, entry) {
  for (const section of worksheet.sections || []) {
    const source = entry.values?.[section.id];
    const rows = section.repeatable ? source || [] : [source || {}];
    for (const row of rows) {
      for (const field of section.fields) {
        if ((field.type === "date" || field.type === "datetime" || field.type === "time") && row?.[field.name]) {
          return String(row[field.name]).replace("T", " ");
        }
      }
    }
  }
  return formatStamp(entry.createdAt);
}

function entrySnippet(worksheet, entry) {
  for (const section of worksheet.sections || []) {
    const source = entry.values?.[section.id];
    const rows = section.repeatable ? source || [] : [source || {}];
    for (const row of rows) {
      for (const field of section.fields) {
        const value = row?.[field.name];
        if (typeof value === "string" && value.trim() && !["date", "datetime", "time"].includes(field.type)) {
          return clip(value);
        }
      }
    }
  }
  return "打开查看";
}

function groupedWorksheets() {
  const groups = new Map();
  for (const worksheet of worksheets()) {
    if (!groups.has(worksheet.category)) groups.set(worksheet.category, []);
    groups.get(worksheet.category).push(worksheet);
  }
  const order = ["每天", "当下", "想法", "事后", "行动", "沟通", "计划"];
  return [...groups.keys()]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map((category) => ({ category, items: groups.get(category) }));
}

function worksheetHref(worksheet) {
  if (worksheet.id === "eight_week_plan") return "#/plan";
  return sheetPath(worksheet.id);
}

function renderHome() {
  const settings = loadSettings();
  const checkin = getWs("daily_checkin");
  const today = todayIso();
  const todayEntry = checkin ? findEntryForDate(checkin, today) : null;
  const collected = checkin ? collectScoreRows(checkin, listEntries(load(), checkin.id)) : { fields: [], rows: [] };
  const todayRow = collected.rows.find((row) => row.date === today);
  const pills = collected.fields
    .map((field) => {
      const value = todayRow ? todayRow[field.name] : null;
      return `<div><span>${esc(shortLabel(field.label))}</span><strong>${value == null ? "—" : esc(value)}</strong></div>`;
    })
    .join("");
  const checkinHref = todayEntry ? sheetPath(checkin.id, todayEntry.id) : sheetPath(checkin.id, "new");
  const plan = load().plan;
  const planWs = getWs("eight_week_plan");
  const stats = planStats(plan, planWs?.weeks?.length || 8);
  const weekNo = currentWeekNumber(plan.startDate, planWs?.weeks?.length || 8);
  const theme = (planWs?.weeks || []).find((week) => week.week === weekNo)?.theme || "";
  const hint = !settings.hintDismissed && !isStandalone()
    ? `<div class="install-hint"><p>用 iPhone 的 Safari 打开，点分享，再选「添加到主屏幕」。第一次打开后可以离线使用。</p><button type="button" class="btn btn-secondary" data-action="dismiss-hint">知道了</button></div>`
    : "";
  const groups = groupedWorksheets()
    .map((group) => {
      const cards = group.items
        .map((worksheet) => {
          const count = listEntries(load(), worksheet.id).length;
          return `<a class="sheet-card" href="${worksheetHref(worksheet)}">
            <span class="sheet-top"><span class="sheet-title">${esc(worksheet.title)}</span>${count ? `<span class="count">${count} 条</span>` : ""}</span>
            <span class="muted clamp-2">${esc(worksheet.when_to_use)}</span>
          </a>`;
        })
        .join("");
      return `<h2 class="group-title">${esc(group.category)}</h2>${cards}`;
    })
    .join("");
  return shell({
    tab: "home",
    title: "情绪练习",
    content: `${hint}
      <p class="lede">情绪上来的时候，用得上的几张表。</p>
      <a class="sos-btn" href="#/sos">快要发火了<small>停一下，做三分钟呼吸空间</small></a>
      <section class="card">
        <span class="kicker">每日打卡</span>
        <h2>今天</h2>
        <p class="muted">${todayRow ? "今天已经记下了。" : "睡前两分钟就够。看一段时间的变化，不评判某一天。"}</p>
        <div class="score-pills">${pills}</div>
        <div class="row-actions">
          <a class="btn btn-primary" href="${checkinHref}">${todayEntry ? "查看今天" : "记今天"}</a>
          <a class="btn btn-secondary" href="#/w/daily_checkin">趋势</a>
        </div>
      </section>
      <a class="card home-card" href="#/plan">
        <span class="kicker">八周计划</span>
        <strong>${plan.startDate ? `第 ${weekNo} 周` : "还没选开始日期"}</strong>
        <span class="muted">${esc(theme || planWs?.when_to_use || "")}</span>
        <span class="muted">已勾选 ${stats.total} / ${stats.max}</span>
      </a>
      ${groups}
      <p class="foot-note">这些练习不能代替医生或咨询师。若有伤害自己的念头，请打开<a href="#/about">关于</a>里的援助热线。</p>
      <p><a href="emotion-worksheets.pdf">打印版《情绪练习表》</a></p>`,
  });
}

function latestPrep() {
  const entries = listEntries(load(), "anger_quick_card");
  for (const entry of entries) {
    const prep = entry.values?.prep;
    if (!prep) continue;
    if (prep.pause_phrase || prep.self_care_action || (Array.isArray(prep.body_signals) && prep.body_signals.length)) {
      return prep;
    }
  }
  return null;
}

function parsePhase(item, index) {
  const text = String(item);
  const withoutNum = text.replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, "");
  const parts = withoutNum.split(/：|:/);
  const name = (parts[0] || `第 ${index + 1} 分钟`).replace(/（.*?）/g, "").trim();
  const guide = parts.slice(1).join("：").trim() || withoutNum;
  return { name, guide };
}

function ensurePhases(step) {
  const phases = (step?.items || []).map(parsePhase).filter((phase) => phase.guide);
  timer.phases = phases.length ? phases : [{ name: "呼吸", guide: "把注意力放在呼吸上。" }];
}

function ringSVG() {
  return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"></circle><circle class="ring-fg" cx="60" cy="60" r="52" transform="rotate(-90 60 60)"></circle></svg>`;
}

function renderSos() {
  const worksheet = getWs("anger_quick_card");
  if (!worksheet) return shell({ tab: "", title: "快要发火了", back: "#/", content: "<p>这张表没有加载。</p>" });
  const prep = latestPrep();
  const quote = prep
    ? `<div class="quote"><p class="kicker">我可以这样说</p><p>${esc(prep.pause_phrase || "先停一下。")}</p>${prep.self_care_action ? `<p class="muted">然后：${esc(prep.self_care_action)}</p>` : ""}${Array.isArray(prep.body_signals) && prep.body_signals.length ? `<p class="muted">身体信号：${esc(prep.body_signals.join("、"))}</p>` : ""}<p><a href="${sheetPath(worksheet.id)}">修改我的应对卡</a></p></div>`
    : `<p><a class="btn btn-secondary btn-block" href="${sheetPath(worksheet.id, "new")}">先写好我的缓一下的话</a></p>`;
  const breath = (worksheet.steps || []).find((step) => step.title.includes("呼吸"));
  const doors = (worksheet.steps || []).find((step) => step.title.includes("门"));
  ensurePhases(breath);
  const log = worksheet.sections.find((section) => section.id === "log");
  const settings = loadSettings();
  const dots = timer.phases.map((phase) => `<span data-phase-dot>${esc(phase.name)}</span>`).join("");
  const timerCard = `<section class="card" id="timer">
        <p class="kicker">${esc(breath?.title || "三分钟呼吸空间")}</p>
        <div class="phase-dots">${dots}</div>
        <div class="ring-wrap">${ringSVG()}</div>
        <p id="timer-clock" class="clock">3:00</p>
        <h2 id="timer-phase" class="phase-name" aria-live="polite">${esc(timer.phases[0]?.name || "")}</h2>
        <p id="timer-guide" class="guide">${esc(timer.phases[0]?.guide || "")}</p>
        <p id="timer-phase-left" class="phase-left">一共三分钟，大约每分钟一步</p>
        <p id="timer-done" class="guide" hidden>三分钟结束了。可以停在这里，也可以选下面的一扇门。</p>
        <div class="timer-actions">
          <button type="button" class="btn btn-primary" data-action="timer-toggle">开始</button>
          <button type="button" class="btn btn-secondary" data-action="timer-reset">重来</button>
        </div>
        <label class="chime"><input type="checkbox" id="chime"${settings.chime ? " checked" : ""}>阶段结束时轻声提示</label>
      </section>`;
  const doorButtons = (doors?.items || [])
    .map((item) => {
      const [name, ...rest] = String(item).split("：");
      return `<button type="button" class="door" data-action="pick-door" data-door="${esc(name.trim())}" aria-pressed="false"><strong>${esc(name.trim())}</strong><small>${esc(rest.join("："))}</small></button>`;
    })
    .join("");
  const doorCard = `<section class="block">
        <h2>${esc(doors?.title || "选一扇门")}</h2>
        <div class="door-list">${doorButtons}</div>
      </section>`;
  const steps = (worksheet.steps || [])
    .map((step) => {
      if (step === breath || step.title.includes("呼吸")) return timerCard;
      if (step === doors || step.title.includes("门")) return doorCard;
      return `<section class="block steps"><h2>${esc(step.title)}</h2><ol>${step.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></section>`;
    })
    .join("");
  return shell({
    tab: "",
    title: "快要发火了",
    back: "#/",
    content: `${quote}
      ${steps}
      <section class="block" id="sos-log" data-section-id="log">
        <h2>${esc(log?.title || "用后小记")}</h2>
        ${log ? fieldsHTML(log, blankRow(log), "sos") : ""}
        <button type="button" class="btn btn-primary btn-block" data-action="save-sos">记下这次</button>
      </section>
      <p class="foot-note">如果念头转向伤害自己，请停下来，联系<a href="#/about">援助热线</a>。</p>`,
  });
}

function currentWeekNumber(startDate, totalWeeks) {
  if (!startDate) return 1;
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date(`${todayIso()}T00:00:00`);
  const diff = Math.floor((today - start) / 86400000);
  if (Number.isNaN(diff) || diff < 0) return 1;
  return Math.min(totalWeeks, Math.floor(diff / 7) + 1);
}

function planStats(plan, weeks) {
  let total = 0;
  const max = weeks * 14;
  for (let week = 1; week <= weeks; week += 1) {
    for (let day = 1; day <= 7; day += 1) {
      if (plan.checks[`${week}:${day}:formal`]) total += 1;
      if (plan.checks[`${week}:${day}:informal`]) total += 1;
    }
  }
  return { total, max };
}

function weekCount(plan, week) {
  let count = 0;
  for (let day = 1; day <= 7; day += 1) {
    if (plan.checks[`${week}:${day}:formal`]) count += 1;
    if (plan.checks[`${week}:${day}:informal`]) count += 1;
  }
  return count;
}

function renderPlan() {
  const worksheet = getWs("eight_week_plan");
  const plan = load().plan;
  const weeks = worksheet?.weeks || [];
  const totalWeeks = weeks.length || 8;
  const stats = planStats(plan, totalWeeks);
  const current = currentWeekNumber(plan.startDate, totalWeeks);
  const cards = weeks
    .map((week) => {
      const open = week.week === current;
      const days = Array.from({ length: 7 }, (_, index) => {
        const day = index + 1;
        const date = plan.startDate ? addDays(plan.startDate, (week.week - 1) * 7 + day - 1) : "";
        const formal = plan.checks[`${week.week}:${day}:formal`] ? " checked" : "";
        const informal = plan.checks[`${week.week}:${day}:informal`] ? " checked" : "";
        const label = date ? formatDayLabel(date) : `第 ${day} 天`;
        return `<div class="day-row${date === todayIso() ? " is-today" : ""}">
          <span>${esc(label)}</span>
          <label class="day-check"><input type="checkbox" data-check="${week.week}:${day}:formal"${formal}>正式</label>
          <label class="day-check"><input type="checkbox" data-check="${week.week}:${day}:informal"${informal}>日常</label>
        </div>`;
      }).join("");
      const extra = plan.checks[`${week.week}:extra`] ? " checked" : "";
      return `<details class="week"${open ? " open" : ""}>
        <summary><span>第 ${esc(week.week)} 周 · ${esc(week.theme)}</span><span class="muted" data-week-progress="${esc(week.week)}">${weekCount(plan, week.week)} / 14</span></summary>
        <div class="week-meta">
          <p><span class="k">正式</span>${esc(week.formal)}</p>
          <p><span class="k">日常</span>${esc(week.informal)}</p>
          <p><span class="k">本周另外</span>${esc(week.extra)}</p>
        </div>
        ${days}
        <label class="choice"><input type="checkbox" data-check="${week.week}:extra"${extra}><span>本周额外任务做了</span></label>
        <label class="field-label" for="note-${week.week}">一句话感受</label>
        <textarea id="note-${week.week}" rows="2" data-week-note="${esc(week.week)}">${esc(plan.notes[String(week.week)] || "")}</textarea>
      </details>`;
    })
    .join("");
  return shell({
    tab: "plan",
    title: worksheet?.title || "8 周练习",
    back: "#/",
    content: `${worksheet ? guidanceHTML(worksheet) : ""}
      ${worksheet ? sourcesHTML(worksheet.sources) : ""}
      <section class="card">
        <label class="field-label" for="plan-start">开始日期</label>
        <p class="hint">用来标出每一天的日期。被打断了也不用从头再来。</p>
        <input id="plan-start" type="date" data-plan-start value="${esc(plan.startDate)}">
        <button type="button" class="btn btn-secondary btn-block" data-action="plan-start-today">从今天开始</button>
        <p>正式和日常已勾选 <strong data-progress="total">${stats.total} / ${stats.max}</strong></p>
      </section>
      ${cards}
      <p><a class="btn btn-secondary btn-block" href="${sheetPath("eight_week_plan")}">每周总结表</a></p>
      <details>
        <summary>重新开始勾选</summary>
        <p class="muted">只清空八周的勾选、每句感受和开始日期。已经保存的练习记录还在。</p>
        <button type="button" class="btn btn-danger" data-action="reset-plan">清空八周勾选</button>
      </details>`,
  });
}

function renderAbout() {
  const books = (pack.sources || []).map((source) => `<li>${esc(source)}</li>`).join("");
  return shell({
    tab: "about",
    title: "关于",
    back: "#/",
    content: `<section class="card">
        <h2>这是什么</h2>
        <p>${esc(pack.description || "")}</p>
        <p>打开首页的「快要发火了」，可以先停一下，再做一个三分钟呼吸空间。每天打卡看的是一段时间的变化。八周计划按一周一个主题来勾。</p>
      </section>
      <section class="card">
        <h2>记录在哪里</h2>
        <p>全部记在这台设备的浏览器里，用的是本地存储。这个网页没有服务器，也不会统计访问，不会把内容发出去。</p>
        <p>换浏览器、清除网站数据，或者换手机，记录会消失。想留一份，就导出备份。</p>
        <p>在 iPhone 上，Safari 里的记录和「添加到主屏幕」之后的图标，有时不是同一份。常用哪一种，就在那一种里导出。</p>
        <button type="button" class="btn btn-primary btn-block" data-action="export-data">导出 JSON 备份</button>
        <label class="btn btn-secondary btn-block" for="import-file">导入备份</label>
        <input id="import-file" type="file" accept="application/json,.json" hidden>
      </section>
      <section class="card">
        <h2>删除全部记录</h2>
        <p>会删掉这台设备上的打卡、练习记录和八周勾选。已经下载到文件里的备份不会被删。</p>
        <button type="button" class="btn btn-danger btn-block" data-action="delete-all">删除全部记录</button>
      </section>
      <section class="card">
        <h2>加到 iPhone 主屏幕</h2>
        <ol>
          <li>用 Safari 打开这个页面。</li>
          <li>点底部的分享按钮。</li>
          <li>选择「添加到主屏幕」。</li>
          <li>名称会显示为「情绪练习」。</li>
        </ol>
        <p>第一次需要联网。打开过之后，没有网络也能使用。</p>
        <p>在安卓上，可以用 Chrome 菜单里的「添加到主屏幕」或「安装应用」。</p>
      </section>
      <section class="card">
        <h2>打印</h2>
        <p><a class="btn btn-secondary" href="emotion-worksheets.pdf" target="_blank" rel="noopener">打开打印版 PDF</a></p>
      </section>
      <section class="safety">
        <h2>不能代替医生或咨询师</h2>
        <p>这些练习整理自下面几本书的读书笔记，只供自己练习，不能代替诊断和治疗。如果出现伤害自己的念头，或者觉得撑不下去了，请联系身边的人，或打下面的电话。</p>
        ${hotlinesHTML()}
      </section>
      <section class="card">
        <h2>书</h2>
        <ul>${books}</ul>
      </section>`,
  });
}

function renderSheet(route) {
  const worksheet = getWs(route.id);
  if (!worksheet) {
    return shell({ tab: "", title: "没有这张表", back: "#/", content: `<p>没有找到这张练习表。</p>` });
  }
  if (route.mode === "list") return renderSheetList(worksheet);
  if (route.mode === "view") return renderSheetView(worksheet, route.entryId);
  return renderSheetEdit(worksheet, route.entryId);
}

function renderSheetList(worksheet) {
  const entries = listEntries(load(), worksheet.id);
  const history = entries.length
    ? entries
        .map(
          (entry) => `<a class="entry-link" href="${sheetPath(worksheet.id, entry.id)}">
            <strong>${esc(entryWhen(worksheet, entry))}</strong>
            <span class="muted">${esc(entrySnippet(worksheet, entry))}</span>
          </a>`,
        )
        .join("")
    : `<p class="muted">还没有记录。写下来就好，不用写完整。</p>`;
  const todayEntry = worksheet.id === "daily_checkin" ? findEntryForDate(worksheet, todayIso()) : null;
  const primaryHref = todayEntry ? sheetPath(worksheet.id, todayEntry.id, "edit") : sheetPath(worksheet.id, "new");
  const primaryLabel = worksheet.id === "daily_checkin" ? (todayEntry ? "改今天" : "记今天") : "写一条新的";
  const chart = worksheet.id === "daily_checkin" ? `<div id="chart-host">${chartBlock(worksheet)}</div>` : "";
  const planLink = worksheet.id === "eight_week_plan"
    ? `<p><a class="btn btn-secondary btn-block" href="#/plan">打开每日勾选</a></p>`
    : "";
  return shell({
    tab: tabFor({ name: "sheet", id: worksheet.id }),
    title: worksheet.title,
    back: "#/",
    content: `<p class="pill">${esc(worksheet.category)}</p>
      ${guidanceHTML(worksheet)}
      ${chart}
      ${planLink}
      <p><a class="btn btn-primary btn-block" href="${primaryHref}">${primaryLabel}</a></p>
      <h2>记录</h2>
      ${history}
      ${safetyHTML(worksheet)}
      ${stepsHTML(worksheet.steps)}
      ${referenceHTML(worksheet.reference)}
      ${(worksheet.weeks || []).map((week) => `<article class="card"><h2>第 ${esc(week.week)} 周 · ${esc(week.theme)}</h2><p><span class="k">正式</span>${esc(week.formal)}</p><p><span class="k">日常</span>${esc(week.informal)}</p><p><span class="k">本周另外</span>${esc(week.extra)}</p></article>`).join("")}
      ${sourcesHTML(worksheet.sources)}`,
  });
}

function renderSheetView(worksheet, entryId) {
  const entry = getEntry(load(), worksheet.id, entryId);
  if (!entry) {
    return shell({
      tab: tabFor({ name: "sheet", id: worksheet.id }),
      title: worksheet.title,
      back: sheetPath(worksheet.id),
      content: `<p>没有这条记录，可能已经删除了。</p>`,
    });
  }
  return shell({
    tab: tabFor({ name: "sheet", id: worksheet.id }),
    title: worksheet.title,
    back: sheetPath(worksheet.id),
    content: `<p class="muted">${esc(entryWhen(worksheet, entry))} · 保存于 ${esc(formatStamp(entry.updatedAt))}</p>
      ${viewHTML(worksheet, entry.values)}
      <div class="compose-actions">
        <a class="btn btn-secondary" href="${sheetPath(worksheet.id, entry.id, "edit")}">编辑</a>
        <button type="button" class="btn btn-danger" data-action="delete-entry" data-worksheet="${esc(worksheet.id)}" data-id="${esc(entry.id)}">删除</button>
      </div>
      <details><summary>什么时候用、怎么填</summary>${guidanceHTML(worksheet)}${referenceHTML(worksheet.reference)}</details>`,
  });
}

function editorValues(worksheet, entry) {
  if (seed) {
    const next = seed;
    seed = null;
    return next;
  }
  if (entry?.values) return entry.values;
  return blankValuesSafe(worksheet);
}

function blankValuesSafe(worksheet) {
  return exampleValues({ ...worksheet, example: {} });
}

function renderSheetEdit(worksheet, entryId) {
  const entry = entryId ? getEntry(load(), worksheet.id, entryId) : null;
  if (entryId && !entry) {
    return shell({
      tab: tabFor({ name: "sheet", id: worksheet.id }),
      title: worksheet.title,
      back: sheetPath(worksheet.id),
      content: `<p>没有这条记录，可能已经删除了。</p>`,
    });
  }
  const values = editorValues(worksheet, entry);
  const exampleButton = worksheet.example
    ? `<button type="button" class="btn btn-secondary" data-action="show-example">看例子</button>`
    : "";
  const deleteButton = entry
    ? `<p><button type="button" class="btn btn-quiet" data-action="delete-entry" data-worksheet="${esc(worksheet.id)}" data-id="${esc(entry.id)}">删除这条记录</button></p>`
    : "";
  return shell({
    tab: tabFor({ name: "sheet", id: worksheet.id }),
    title: entry ? `编辑${worksheet.title}` : worksheet.title,
    back: entry ? sheetPath(worksheet.id, entry.id) : sheetPath(worksheet.id),
    content: `${guidanceHTML(worksheet)}
      ${safetyHTML(worksheet)}
      ${referenceHTML(worksheet.reference)}
      <form id="entry-form" data-worksheet="${esc(worksheet.id)}" data-entry="${esc(entry?.id || "")}" autocomplete="off">
        ${formHTML(worksheet, values)}
        <div class="compose-actions">
          ${exampleButton}
          <button type="button" class="btn btn-primary" data-action="save-entry">保存</button>
        </div>
      </form>
      ${deleteButton}`,
  });
}

function render(options = {}) {
  const route = parseRoute();
  document.documentElement.dataset.page = route.name;
  const app = document.getElementById("app");
  let html = "";
  if (route.name === "home") html = renderHome();
  else if (route.name === "sos") html = renderSos();
  else if (route.name === "plan") html = renderPlan();
  else if (route.name === "about") html = renderAbout();
  else html = renderSheet(route);
  app.innerHTML = html;
  if (route.name === "sos") tick();
  if (options.scroll) window.scrollTo(0, 0);
}

function rerender() {
  const y = window.scrollY;
  render({ scroll: false });
  window.scrollTo(0, y);
}

function refreshProgress() {
  const planWs = getWs("eight_week_plan");
  const totalWeeks = planWs?.weeks?.length || 8;
  const plan = load().plan;
  const stats = planStats(plan, totalWeeks);
  document.querySelectorAll("[data-progress='total']").forEach((el) => {
    el.textContent = `${stats.total} / ${stats.max}`;
  });
  document.querySelectorAll("[data-week-progress]").forEach((el) => {
    el.textContent = `${weekCount(plan, el.dataset.weekProgress)} / 14`;
  });
}

function syncScore(target) {
  const field = target.closest("[data-type='number']");
  if (!field) return;
  const range = field.querySelector("input[type='range']");
  const number = field.querySelector("input[type='number']");
  if (!range || !number) return;
  if (target === range) {
    number.value = range.value;
    field.classList.remove("is-unset");
  } else if (number.value === "") {
    field.classList.add("is-unset");
    range.value = range.min || "0";
  } else {
    range.value = number.value;
    field.classList.remove("is-unset");
  }
  const unset = field.classList.contains("is-unset");
  range.setAttribute("aria-valuetext", unset ? "未填" : range.value);
}

function fmt(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function currentElapsed() {
  if (!timer.running) return timer.elapsed;
  return Math.min(timer.total, timer.elapsed + (Date.now() - timer.startedAt));
}

async function requestWake() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseWake() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function chime(frequency = 523.25) {
  if (!loadSettings().chime) return;
  try {
    const ctx = chime.ctx || new AudioContext();
    chime.ctx = ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.75);
    navigator.vibrate?.(30);
  } catch {
    /* Autoplay limits or missing audio are fine. */
  }
}

function tick() {
  const root = document.getElementById("timer");
  if (!root || !timer.phases.length) return;
  let elapsed = currentElapsed();
  if (timer.running && elapsed >= timer.total) {
    timer.elapsed = timer.total;
    timer.running = false;
    timer.done = true;
    elapsed = timer.total;
    releaseWake();
    if (!timer.finishedChimed) {
      timer.finishedChimed = true;
      chime(659.25);
    }
    precheckUsed();
  }
  const phaseLen = timer.total / timer.phases.length;
  const phaseIndex = timer.done
    ? timer.phases.length - 1
    : Math.min(timer.phases.length - 1, Math.floor(elapsed / phaseLen));
  if (timer.running && timer.lastPhase !== -1 && phaseIndex !== timer.lastPhase) chime();
  if (timer.running || timer.done) timer.lastPhase = phaseIndex;
  const phase = timer.phases[phaseIndex];
  const remain = Math.max(0, timer.total - elapsed);
  const phaseRemain = Math.max(0, phaseLen - (elapsed - phaseIndex * phaseLen));
  const ring = root.querySelector(".ring-fg");
  const circumference = 2 * Math.PI * 52;
  if (ring) {
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - elapsed / timer.total)}`;
  }
  const clock = root.querySelector("#timer-clock");
  if (clock) clock.textContent = fmt(remain);
  const phaseEl = root.querySelector("#timer-phase");
  if (phaseEl) phaseEl.textContent = phase?.name || "";
  const guide = root.querySelector("#timer-guide");
  if (guide) guide.textContent = phase?.guide || "";
  const phaseLeft = root.querySelector("#timer-phase-left");
  if (phaseLeft) {
    phaseLeft.textContent = timer.done
      ? "这一轮结束了"
      : elapsed <= 0 && !timer.running
        ? "一共三分钟，大约每分钟一步"
        : `这一分钟还剩 ${fmt(phaseRemain)}`;
  }
  root.querySelectorAll("[data-phase-dot]").forEach((dot, index) => {
    dot.classList.toggle("is-current", index === phaseIndex && !timer.done);
    dot.classList.toggle("is-done", timer.done || index < phaseIndex);
  });
  const toggle = root.querySelector("[data-action='timer-toggle']");
  if (toggle) toggle.textContent = timer.done ? "再来一次" : timer.running ? "暂停" : elapsed > 0 ? "继续" : "开始";
  const done = root.querySelector("#timer-done");
  if (done) done.hidden = !timer.done;
  root.dataset.state = timer.done ? "done" : timer.running ? "running" : elapsed > 0 ? "paused" : "idle";
}

function startTimer() {
  if (timer.done) return;
  timer.running = true;
  timer.startedAt = Date.now();
  requestWake();
  tick();
}

function pauseTimer() {
  if (!timer.running) return;
  timer.elapsed = Math.min(timer.total, timer.elapsed + (Date.now() - timer.startedAt));
  timer.running = false;
  releaseWake();
  tick();
}

function resetTimer() {
  timer.running = false;
  timer.done = false;
  timer.elapsed = 0;
  timer.lastPhase = -1;
  timer.finishedChimed = false;
  releaseWake();
  tick();
}

function precheckUsed() {
  const wrap = document.querySelector("#sos-log [data-field='used']");
  if (!wrap) return;
  const boxes = [...wrap.querySelectorAll("input[data-opt]")];
  if (boxes.some((box) => box.checked)) return;
  for (const box of boxes) {
    if (box.value === "STOP" || box.value.includes("呼吸空间")) box.checked = true;
  }
}

function showExample(worksheet) {
  const modal = document.getElementById("modal");
  modal.hidden = false;
  modal.innerHTML = `<div class="dialog dialog-sheet" role="dialog" aria-modal="true" aria-labelledby="ex-title">
    <h2 id="ex-title">例子</h2>
    <p class="muted">这是示范，不是你的记录。</p>
    <div class="example-body">${viewHTML(worksheet, exampleValues(worksheet))}</div>
    <div class="dialog-actions">
      <button type="button" class="btn btn-secondary" data-cancel>关闭</button>
      <button type="button" class="btn btn-primary" data-action="fill-example">填入表单</button>
    </div>
  </div>`;
}

async function saveCurrentEntry() {
  const form = document.getElementById("entry-form");
  if (!form) return;
  const worksheet = getWs(form.dataset.worksheet);
  if (!worksheet) return;
  const values = readForm(worksheet, form);
  if (!hasContent(worksheet, values)) {
    toast("先写一点再保存");
    return;
  }
  const errors = validateNumbers(worksheet, values);
  if (errors.length) {
    toast(errors[0]);
    return;
  }
  const existing = form.dataset.entry ? getEntry(load(), worksheet.id, form.dataset.entry) : null;
  const now = new Date().toISOString();
  const entry = {
    id: existing?.id || uid(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    values,
  };
  try {
    upsertEntry(load(), worksheet.id, entry);
  } catch {
    toast("无法保存。请检查浏览器是否禁止了本地存储。");
    return;
  }
  toast("已保存在这台设备上");
  location.hash = sheetPath(worksheet.id, entry.id);
}

async function saveSosLog() {
  const worksheet = getWs("anger_quick_card");
  const root = document.getElementById("sos-log");
  const section = worksheet?.sections.find((item) => item.id === "log");
  if (!worksheet || !root || !section) return;
  const row = readFields(section, root);
  if (isRowEmpty(section, row)) {
    toast("先写一点再保存");
    return;
  }
  const values = blankValuesSafe(worksheet);
  values.log = [row];
  values.prep = {};
  const now = new Date().toISOString();
  try {
    upsertEntry(load(), worksheet.id, { id: uid(), createdAt: now, updatedAt: now, values });
  } catch {
    toast("无法保存。请检查浏览器是否禁止了本地存储。");
    return;
  }
  toast("这次已记下");
  location.hash = sheetPath(worksheet.id);
}

function download(filename, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function onImport(file) {
  if (!file) return;
  let text = "";
  try {
    text = await file.text();
    const next = parseImport(text);
    const ok = await confirmDialog({
      title: "导入备份",
      body: "导入会替换这台设备上现有的记录和八周勾选。如果还需要现在这些内容，先导出一份。",
      confirmText: "替换并导入",
      danger: true,
    });
    if (!ok) return;
    writeState(next);
    toast("已导入");
    rerender();
  } catch (error) {
    toast(error.message || "无法导入");
  }
}

async function onClick(event) {
  const backdrop = event.target.id === "modal";
  if (backdrop) {
    closeModal(false);
    return;
  }
  if (event.target.closest("[data-ok]")) {
    closeModal(true);
    return;
  }
  if (event.target.closest("[data-cancel]")) {
    closeModal(false);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "cycle-theme") {
    const settings = loadSettings();
    const order = ["auto", "light", "dark"];
    settings.theme = order[(Math.max(0, order.indexOf(settings.theme)) + 1) % order.length];
    saveSettings(settings);
    applyTheme(settings.theme);
    button.innerHTML = themeIcon(settings.theme);
    button.setAttribute("aria-label", themeLabel(settings.theme));
    return;
  }
  if (action === "dismiss-hint") {
    const settings = loadSettings();
    settings.hintDismissed = true;
    saveSettings(settings);
    button.closest(".install-hint")?.remove();
    return;
  }
  if (action === "chart-range") {
    ui.chartDays = Number(button.dataset.days) === 30 ? 30 : 7;
    const host = document.getElementById("chart-host");
    const worksheet = getWs("daily_checkin");
    if (host && worksheet) host.innerHTML = chartBlock(worksheet);
    return;
  }
  if (action === "add-row") {
    const sectionEl = button.closest("[data-section-id]");
    const form = button.closest("[data-worksheet]");
    const worksheet = getWs(form?.dataset.worksheet || "");
    const section = worksheet?.sections.find((item) => item.id === sectionEl?.dataset.sectionId);
    if (!section) return;
    sectionEl.querySelector(":scope > .rows")?.insertAdjacentHTML("beforeend", rowHTML(section, blankRow(section), Date.now()));
    return;
  }
  if (action === "remove-row") {
    button.closest(".row")?.remove();
    return;
  }
  if (action === "show-example") {
    const form = document.getElementById("entry-form");
    const worksheet = getWs(form?.dataset.worksheet || "");
    if (worksheet) showExample(worksheet);
    return;
  }
  if (action === "fill-example") {
    const form = document.getElementById("entry-form");
    const worksheet = getWs(form?.dataset.worksheet || "");
    if (!form || !worksheet) return;
    closeModal(false);
    if (hasContent(worksheet, readForm(worksheet, form))) {
      const ok = await confirmDialog({
        title: "填入例子",
        body: "会用例子覆盖现在写的内容。这一步还不会保存。",
        confirmText: "覆盖",
        danger: false,
      });
      if (!ok) return;
    }
    seed = exampleValues(worksheet);
    rerender();
    return;
  }
  if (action === "save-entry") {
    await saveCurrentEntry();
    return;
  }
  if (action === "save-sos") {
    await saveSosLog();
    return;
  }
  if (action === "delete-entry") {
    const worksheetId = button.dataset.worksheet;
    const entryId = button.dataset.id;
    const ok = await confirmDialog({
      title: "删除这条记录",
      body: "只删除这一条。删除后不能恢复。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      deleteEntry(load(), worksheetId, entryId);
    } catch {
      toast("无法删除。请检查浏览器是否禁止了本地存储。");
      return;
    }
    toast("已删除");
    location.hash = sheetPath(worksheetId);
    return;
  }
  if (action === "delete-all") {
    const ok = await confirmDialog({
      title: "删除全部记录",
      body: "会删除这台设备上的打卡、练习记录和八周勾选。删除后不能恢复。已经导出的文件不会被删除。",
      confirmText: "确认删除",
      danger: true,
    });
    if (!ok) return;
    try {
      writeState(emptyState());
    } catch {
      toast("无法删除。请检查浏览器是否禁止了本地存储。");
      return;
    }
    toast("已全部删除");
    rerender();
    return;
  }
  if (action === "export-data") {
    const payload = exportPayload(load());
    download(`情绪练习-备份-${todayIso()}.json`, JSON.stringify(payload, null, 2));
    toast("备份已开始下载");
    return;
  }
  if (action === "plan-start-today") {
    const state = load();
    state.plan.startDate = todayIso();
    save(state);
    rerender();
    return;
  }
  if (action === "reset-plan") {
    const ok = await confirmDialog({
      title: "清空八周勾选",
      body: "勾选、每句感受和开始日期会被清空。练习记录还在。",
      confirmText: "清空勾选",
      danger: true,
    });
    if (!ok) return;
    const state = load();
    state.plan = { startDate: "", checks: {}, notes: {} };
    save(state);
    rerender();
    return;
  }
  if (action === "timer-toggle") {
    if (timer.done) resetTimer();
    else if (timer.running) pauseTimer();
    else startTimer();
    return;
  }
  if (action === "timer-reset") {
    resetTimer();
    return;
  }
  if (action === "pick-door") {
    const name = button.dataset.door;
    document.querySelectorAll("[data-action='pick-door']").forEach((item) => {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
    const radio = [...document.querySelectorAll("#sos-log input[type='radio']")].find((input) => input.value === name);
    if (radio) radio.checked = true;
  }
}

function onInput(event) {
  const target = event.target;
  if (target.matches("[data-type='number'] input, [data-field] input[type='range'], [data-field] input[type='number']")) {
    if (target.closest("[data-type='number']")) syncScore(target);
  }
  if (target.dataset.weekNote != null) {
    const state = load();
    state.plan.notes[target.dataset.weekNote] = target.value;
    save(state);
  }
  if (target.matches("[data-other-text]") && target.value.trim()) {
    const toggle = target.closest(".field")?.querySelector("[data-other-toggle]");
    if (toggle) toggle.checked = true;
  }
}

function onChange(event) {
  const target = event.target;
  if (target.id === "chime") {
    const settings = loadSettings();
    settings.chime = target.checked;
    saveSettings(settings);
    return;
  }
  if (target.matches("[data-other-toggle]")) {
    const text = target.closest(".field")?.querySelector("[data-other-text]");
    if (text) {
      text.hidden = !target.checked;
      if (target.checked) text.focus();
    }
    return;
  }
  if (target.dataset.check) {
    const state = load();
    if (target.checked) state.plan.checks[target.dataset.check] = true;
    else delete state.plan.checks[target.dataset.check];
    save(state);
    refreshProgress();
    return;
  }
  if (target.dataset.planStart != null) {
    const state = load();
    state.plan.startDate = target.value;
    save(state);
    rerender();
    return;
  }
  if (target.id === "import-file") {
    const file = target.files?.[0];
    target.value = "";
    onImport(file);
  }
}

function syncOffline() {
  const offline = !navigator.onLine;
  const banner = document.getElementById("offline-banner");
  if (banner) banner.hidden = !offline;
  document.body.classList.toggle("is-offline", offline);
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {});
}

async function boot() {
  applyTheme(loadSettings().theme);
  bind();
  syncOffline();
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(String(response.status));
    pack = await response.json();
    if (!Array.isArray(pack.worksheets)) throw new Error("练习表格式无法识别");
  } catch {
    document.getElementById("app").innerHTML = `<main class="wrap"><h1>练习表没有加载成功</h1><p>如果是第一次打开，需要先连一次网络。连上之后再打开，就可以离线使用。</p></main>`;
    registerSW();
    return;
  }
  render({ scroll: true });
  registerSW();
  setInterval(tick, 250);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (loadSettings().theme === "auto") applyTheme("auto");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && timer.running) requestWake();
  });
}

function bind() {
  window.addEventListener("hashchange", () => {
    closeModal(false);
    render({ scroll: true });
  });
  window.addEventListener("online", syncOffline);
  window.addEventListener("offline", syncOffline);
  document.addEventListener("click", (event) => {
    onClick(event);
  });
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("submit", (event) => event.preventDefault());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal(false);
  });
}

boot();
