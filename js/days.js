import { load, save } from "./store.js";
import { addDays, esc, formatDayLabel, todayIso, uid } from "./util.js";

export const SUGGESTIONS = [
  { id: "walk", label: "运动/散步", title: "晚饭后快走30分钟", minimum: "实在累就走10分钟", time: "19:30" },
  { id: "read", label: "读书", title: "睡前读10页", minimum: "读2页也算", time: "22:00" },
  { id: "mind", label: "正念练习", title: "正念练习10分钟", minimum: "坐下1分钟", time: "" },
  { id: "breath", label: "呼吸空间", title: "起床后做3分钟呼吸空间", minimum: "呼吸三次", time: "07:30" },
  { id: "joy", label: "愉快活动", title: "做一件让自己高兴的小事", minimum: "哪怕5分钟", time: "" },
  { id: "need", label: "说出需要", title: "用一句话说出一个需要", minimum: "先写下来，不一定说出口", time: "" },
];

export function isDayDone(item) {
  return item?.status === "done" || item?.status === "minimum";
}

export function listDays(state = load()) {
  return Object.values(state.days || {}).sort((a, b) => b.date.localeCompare(a.date));
}

export function getDay(date, state = load()) {
  return state.days?.[date] || null;
}

export function completionText(day) {
  const total = day?.items?.length || 0;
  const done = (day?.items || []).filter(isDayDone).length;
  if (!total) return "还没有小事";
  if (done === total) return `${done}/${total} 都做了`;
  return `${done}/${total} 完成`;
}

export function softLimitText(count) {
  if (count > 3) return "已经超过三件了。多出来的可以留到另一天，不做完也没关系。";
  if (count === 3) return "三件就够了。再多容易变成负担。";
  return "写两件到三件很小、很具体的事就好。";
}

function touch(day) {
  day.updatedAt = new Date().toISOString();
  if (!day.createdAt) day.createdAt = day.updatedAt;
  return day;
}

export function markItem(date, itemId, mark) {
  const state = load();
  const day = state.days?.[date];
  const item = day?.items?.find((entry) => entry.id === itemId);
  if (!item) return state;
  const next = mark === "minimum" && !item.minimum ? "done" : mark;
  item.status = item.status === next ? "open" : next;
  touch(day);
  return save(state);
}

export function saveReview(date, note) {
  const state = load();
  const day = state.days?.[date];
  if (!day) return state;
  day.reviewNote = note;
  touch(day);
  return save(state);
}

export function saveDayItems(date, drafts) {
  const state = load();
  const existing = state.days?.[date];
  const byId = new Map((existing?.items || []).map((item) => [item.id, item]));
  const items = drafts
    .map((draft) => {
      const title = draft.title.trim();
      if (!title) return null;
      const previous = byId.get(draft.id);
      return {
        id: draft.id || uid(),
        title,
        time: draft.time || "",
        minimum: (draft.minimum || "").trim(),
        status: previous?.status || "open",
        carriedFrom: previous?.carriedFrom || "",
        carriedTo: previous?.carriedTo || "",
      };
    })
    .filter(Boolean);
  if (!items.length && !(existing?.reviewNote || "").trim()) {
    if (state.days?.[date]) delete state.days[date];
    return save(state);
  }
  state.days[date] = touch({
    date,
    createdAt: existing?.createdAt || "",
    updatedAt: "",
    reviewNote: existing?.reviewNote || "",
    items,
  });
  return save(state);
}

export function carryItem(fromDate, itemId) {
  const state = load();
  const source = state.days?.[fromDate];
  const item = source?.items?.find((entry) => entry.id === itemId);
  if (!item || isDayDone(item)) return { state, status: "skip" };
  const targetDate = addDays(todayIso(), 1);
  if (targetDate === fromDate) return { state, status: "skip" };
  const now = new Date().toISOString();
  const dest = state.days[targetDate] || {
    date: targetDate,
    createdAt: now,
    updatedAt: now,
    reviewNote: "",
    items: [],
  };
  const already = dest.items.some((entry) => entry.carriedFrom === fromDate && entry.title === item.title);
  if (!already) {
    dest.items.push({
      id: uid(),
      title: item.title,
      time: item.time,
      minimum: item.minimum,
      status: "open",
      carriedFrom: fromDate,
      carriedTo: "",
    });
  }
  item.carriedTo = targetDate;
  touch(source);
  touch(dest);
  state.days[targetDate] = dest;
  save(state);
  return { state, status: already ? "already" : "added", targetDate };
}

export function deleteDay(date) {
  const state = load();
  if (state.days?.[date]) delete state.days[date];
  return save(state);
}

export function itemEditorHTML(item = {}) {
  const id = item.id || uid();
  return `<div class="row day-edit" data-item-id="${esc(id)}">
    <label class="field-label" for="title-${esc(id)}">做什么</label>
    <input id="title-${esc(id)}" data-day-title type="text" value="${esc(item.title || "")}" placeholder="例如：晚饭后快走30分钟">
    <div class="day-edit-meta">
      <label>时间，可不填<input data-day-time type="time" value="${esc(item.time || "")}"></label>
      <label>最低版本，可不填<input data-day-min type="text" value="${esc(item.minimum || "")}" placeholder="实在累就走10分钟"></label>
    </div>
    <button type="button" class="btn btn-quiet" data-action="remove-day-item">去掉这件</button>
  </div>`;
}

export function readDayEditor(root) {
  return [...root.querySelectorAll(".day-edit")].map((row) => ({
    id: row.dataset.itemId,
    title: row.querySelector("[data-day-title]")?.value || "",
    time: row.querySelector("[data-day-time]")?.value || "",
    minimum: row.querySelector("[data-day-min]")?.value || "",
  }));
}

function statusLine(item) {
  if (item.status === "done") return "做到了";
  if (item.status === "minimum") return "做到了最低版本";
  return "还没做";
}

function todoHTML(date, item) {
  const done = isDayDone(item);
  const time = item.time ? `<span class="muted">${esc(item.time)}</span>` : "";
  const minimum = item.minimum ? `<span class="muted">最低：${esc(item.minimum)}</span>` : "";
  const from = item.carriedFrom ? `<span class="muted">从 ${esc(formatDayLabel(item.carriedFrom))} 留下的</span>` : "";
  const minimumButton = item.minimum
    ? `<button type="button" class="btn btn-secondary" data-action="day-mark" data-date="${esc(date)}" data-item="${esc(item.id)}" data-mark="minimum" aria-pressed="${item.status === "minimum"}">最低版本</button>`
    : "";
  return `<div class="todo${done ? " is-done" : ""}">
    <div class="todo-text">
      <strong>${esc(item.title)}</strong>
      ${time}${minimum}${from}
      <span class="muted">${statusLine(item)}</span>
    </div>
    <div class="todo-actions">
      <button type="button" class="btn btn-secondary" data-action="day-mark" data-date="${esc(date)}" data-item="${esc(item.id)}" data-mark="done" aria-pressed="${item.status === "done"}">做到了</button>
      ${minimumButton}
    </div>
  </div>`;
}

export function homePlanHTML() {
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const day = getDay(today);
  const tomorrowPlan = getDay(tomorrow);
  const tomorrowLine = tomorrowPlan
    ? `<p class="small muted">明天已经写了 ${tomorrowPlan.items.length} 件。<a href="#/tomorrow/${tomorrow}">改明日计划</a></p>`
    : `<p><a class="btn btn-primary btn-block" href="#/tomorrow">写明日计划</a></p>`;
  if (!day) {
    return `<section class="card" id="today-plan">
      <span class="kicker">今日计划</span>
      <h2>今天的两三件小事</h2>
      <p class="muted">还没有写下今天要做的事。很小、很具体就好。</p>
      <div class="row-actions">
        <a class="btn btn-secondary" href="#/tomorrow/${today}">补今天</a>
        <a class="btn btn-primary" href="#/tomorrow">写明日计划</a>
      </div>
    </section>`;
  }
  const items = day.items.map((item) => todoHTML(today, item)).join("");
  return `<section class="card" id="today-plan">
    <div class="sheet-top"><span class="kicker">今日计划</span><a href="#/day">回顾和记录</a></div>
    <h2>今天的两三件小事</h2>
    <p class="muted">${esc(completionText(day))}。做到了，或者只做到最低版本，都算数。</p>
    ${items}
    ${tomorrowLine}
  </section>`;
}

function historyHTML(currentDate) {
  const today = todayIso();
  const rows = listDays().filter((day) => day.date < today && day.date !== currentDate);
  if (!rows.length) return `<p class="muted">以前的计划会出现在这里。</p>`;
  return rows
    .map((day) => {
      const titles = day.items.map((item) => item.title).slice(0, 2).join("、");
      return `<a class="entry-link" href="#/day/${day.date}">
        <strong>${esc(formatDayLabel(day.date))} · ${esc(completionText(day))}</strong>
        <span class="muted">${esc(titles || "没有文字")}</span>
      </a>`;
    })
    .join("");
}

export function dayPageInner(date) {
  const day = getDay(date);
  const today = todayIso();
  const label = date === today ? "今天" : formatDayLabel(date);
  if (!day) {
    return `<p class="lede">${esc(label)}还没有计划。</p>
      <p><a class="btn btn-primary" href="#/tomorrow/${esc(date)}">写这天的两三件小事</a></p>
      <h2>以前的计划</h2>
      ${historyHTML(date)}`;
  }
  const items = day.items
    .map((item) => {
      const carried = item.carriedTo
        ? `<p class="small muted">已经放到 ${esc(formatDayLabel(item.carriedTo))}。</p>`
        : "";
      const carry = !isDayDone(item) && !item.carriedTo
        ? `<button type="button" class="btn btn-secondary" data-action="carry-day" data-date="${esc(date)}" data-item="${esc(item.id)}">放到明天</button>`
        : "";
      return `<div class="review-row">${todoHTML(date, item)}${carry}${carried}</div>`;
    })
    .join("");
  return `<p class="lede">${esc(label)} · ${esc(completionText(day))}。最低版本也算做到了。</p>
    ${items}
    <section class="block">
      <label class="field-label" for="day-review">晚上可以记一句</label>
      <p class="hint">心情有没有松一点，或者什么挡住了。不写也行。</p>
      <textarea id="day-review" data-date="${esc(date)}" rows="3">${esc(day.reviewNote || "")}</textarea>
    </section>
    <p><a class="btn btn-secondary" href="#/tomorrow/${esc(date)}">改这天的计划</a></p>
    <h2>以前的计划</h2>
    ${historyHTML(date)}
    <p><button type="button" class="btn btn-quiet" data-action="delete-day" data-date="${esc(date)}">删除这天的计划</button></p>`;
}

export function editorInner(date) {
  const day = getDay(date);
  const items = day?.items?.length ? day.items : [{}, {}];
  const chips = SUGGESTIONS.map(
    (item) =>
      `<button type="button" data-action="day-suggest" data-suggest="${esc(item.id)}">${esc(item.label)}</button>`,
  ).join("");
  const tomorrow = addDays(todayIso(), 1);
  const lede = date === tomorrow
    ? "给明天留两件到三件很小的事。具体一点，比“好好过”有用。"
    : `这些小事是给 ${formatDayLabel(date)} 的。`;
  return `<p class="lede">${esc(lede)}</p>
    <label class="field-label" for="day-for">这是哪一天</label>
    <input id="day-for" type="date" value="${esc(date)}">
    <p class="hint">常见的可以点一下，再改成自己的话。</p>
    <div class="suggest" role="group" aria-label="常见的小事">${chips}</div>
    <p id="day-soft" class="soft-note">${esc(softLimitText(items.length))}</p>
    <form id="day-editor" data-date="${esc(date)}" autocomplete="off">
      <div id="day-items">${items.map((item) => itemEditorHTML(item)).join("")}</div>
      <button type="button" class="btn btn-secondary btn-block" data-action="add-day-item">再加一件</button>
      <div class="compose-actions">
        <button type="button" class="btn btn-primary" data-action="save-day">保存</button>
      </div>
    </form>`;
}

export function suggestionById(id) {
  return SUGGESTIONS.find((item) => item.id === id) || null;
}

export function editorCount() {
  return document.querySelectorAll("#day-editor .day-edit").length;
}

export function refreshDayHint() {
  const note = document.getElementById("day-soft");
  if (note) note.textContent = softLimitText(editorCount());
}
