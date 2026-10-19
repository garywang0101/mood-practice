const DATA_KEY = "mood-practice:v1";
const SETTINGS_KEY = "mood-practice:settings";

export function emptyState() {
  return {
    version: 1,
    entries: {},
    plan: { startDate: "", checks: {}, notes: {} },
    days: {},
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalize(data) {
  const entries = {};
  if (data?.entries && typeof data.entries === "object" && !Array.isArray(data.entries)) {
    for (const [key, list] of Object.entries(data.entries)) {
      if (!Array.isArray(list)) continue;
      entries[key] = list.filter((entry) => entry && typeof entry === "object" && entry.id);
    }
  }
  const plan = data?.plan && typeof data.plan === "object" ? data.plan : {};
  return {
    version: 1,
    entries,
    plan: {
      startDate: typeof plan.startDate === "string" ? plan.startDate : "",
      checks: plan.checks && typeof plan.checks === "object" && !Array.isArray(plan.checks) ? plan.checks : {},
      notes: plan.notes && typeof plan.notes === "object" && !Array.isArray(plan.notes) ? plan.notes : {},
    },
    days: normalizeDays(data?.days),
  };
}

function normalizeDays(raw) {
  const days = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return days;
  for (const [key, value] of Object.entries(raw)) {
    const day = normalizeDay(value, key);
    if (day) days[day.date] = day;
  }
  return days;
}

function normalizeDay(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
  if (!date) return null;
  const items = Array.isArray(value.items) ? value.items.map(normalizeDayItem).filter(Boolean) : [];
  const reviewNote = typeof value.reviewNote === "string" ? value.reviewNote : "";
  if (!items.length && !reviewNote.trim()) return null;
  return {
    date,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    reviewNote,
    items,
  };
}

function normalizeDayItem(item) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!title) return null;
  const status = item.status === "done" || item.status === "minimum" ? item.status : "open";
  return {
    id: String(item.id),
    title,
    time: typeof item.time === "string" ? item.time : "",
    minimum: typeof item.minimum === "string" ? item.minimum.trim() : "",
    status,
    carriedFrom: typeof item.carriedFrom === "string" ? item.carriedFrom : "",
    carriedTo: typeof item.carriedTo === "string" ? item.carriedTo : "",
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return emptyState();
    return normalize(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function save(state) {
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
  return state;
}

export function writeState(state) {
  return save(normalize(state));
}

export function listEntries(state, worksheetId) {
  return (state.entries[worksheetId] || [])
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function getEntry(state, worksheetId, entryId) {
  return (state.entries[worksheetId] || []).find((entry) => entry.id === entryId) || null;
}

export function upsertEntry(state, worksheetId, entry) {
  const next = clone(state);
  const list = (next.entries[worksheetId] || []).slice();
  const index = list.findIndex((item) => item.id === entry.id);
  if (index >= 0) list[index] = entry;
  else list.push(entry);
  next.entries[worksheetId] = list;
  return save(next);
}

export function deleteEntry(state, worksheetId, entryId) {
  const next = clone(state);
  next.entries[worksheetId] = (next.entries[worksheetId] || []).filter((entry) => entry.id !== entryId);
  return save(next);
}

export function exportPayload(state) {
  return {
    app: "mood-practice",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: state.entries,
    plan: state.plan,
    days: state.days,
  };
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("这个文件不是 JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("备份格式无法识别");
  }
  if (data.app && data.app !== "mood-practice") {
    throw new Error("这不是情绪练习的备份");
  }
  if (!data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) {
    throw new Error("备份里没有记录");
  }
  return normalize(data);
}

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "auto";
    return {
      theme,
      chime: Boolean(raw.chime),
      hintDismissed: Boolean(raw.hintDismissed),
    };
  } catch {
    return { theme: "auto", chime: false, hintDismissed: false };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
