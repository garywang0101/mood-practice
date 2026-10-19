import { asNumber, esc, isoDateTimeLocal, todayIso } from "./util.js";

function cloneValue(value) {
  return Array.isArray(value) ? value.slice() : value;
}

function cloneRow(row) {
  const copy = {};
  for (const [key, value] of Object.entries(row || {})) copy[key] = cloneValue(value);
  return copy;
}

export function blankRow(section) {
  const row = {};
  const today = todayIso();
  const now = isoDateTimeLocal(new Date());
  for (const field of section.fields) {
    if (field.type === "multi_choice") row[field.name] = [];
    else if (field.type === "number") row[field.name] = "";
    else if (field.type === "date") row[field.name] = today;
    else if (field.type === "datetime") row[field.name] = now;
    else row[field.name] = "";
  }
  return row;
}

export function blankValues(worksheet) {
  const values = {};
  for (const section of worksheet.sections || []) {
    values[section.id] = section.repeatable ? [blankRow(section)] : blankRow(section);
  }
  return values;
}

export function exampleValues(worksheet) {
  const values = blankValues(worksheet);
  const example = worksheet.example || {};
  for (const section of worksheet.sections || []) {
    if (section.repeatable) {
      if (Array.isArray(example[section.id])) {
        values[section.id] = example[section.id].map((row) => ({
          ...blankRow(section),
          ...cloneRow(row),
        }));
      }
    } else {
      for (const field of section.fields) {
        if (Object.prototype.hasOwnProperty.call(example, field.name)) {
          values[section.id][field.name] = cloneValue(example[field.name]);
        }
      }
    }
  }
  return values;
}

export function isRowEmpty(section, row) {
  const today = todayIso();
  for (const field of section.fields) {
    const value = row?.[field.name];
    if (Array.isArray(value)) {
      if (value.length) return false;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) return false;
    if (value == null || value === "") continue;
    if (field.type === "date" && value === today) continue;
    if (field.type === "datetime" && String(value).startsWith(today)) continue;
    return false;
  }
  return true;
}

export function hasContent(worksheet, values) {
  for (const section of worksheet.sections || []) {
    const rows = section.repeatable ? values?.[section.id] || [] : [values?.[section.id] || {}];
    for (const row of rows) {
      if (!isRowEmpty(section, row)) return true;
    }
  }
  return false;
}

function rowsFor(field) {
  const lines = Number(field.print_lines) || 2;
  return Math.min(8, Math.max(3, lines + 1));
}

function fieldId(section, rowKey, name) {
  return `f-${section.id}-${rowKey}-${name}`;
}

function choiceHTML(section, field, value, rowKey) {
  const multiple = field.type === "multi_choice";
  const selected = new Set(
    multiple
      ? (Array.isArray(value) ? value : []).map(String)
      : [value == null ? "" : String(value)],
  );
  const known = new Set(field.options || []);
  const extras = multiple ? [...selected].filter((item) => item && !known.has(item)) : [];
  const labelId = fieldId(section, rowKey, field.name);
  const radioName = `r-${section.id}-${rowKey}-${field.name}`;
  const options = (field.options || [])
    .map((option) => {
      const checked = selected.has(option) ? " checked" : "";
      if (multiple) {
        return `<label class="choice"><input type="checkbox" data-opt value="${esc(option)}"${checked}><span>${esc(option)}</span></label>`;
      }
      return `<label class="choice"><input type="radio" name="${esc(radioName)}" value="${esc(option)}"${checked}><span>${esc(option)}</span></label>`;
    })
    .join("");
  const other = field.allow_other
    ? `<label class="choice"><input type="checkbox" data-other-toggle${extras.length ? " checked" : ""}><span>其他</span></label>
       <input class="other-text" type="text" data-other-text value="${esc(extras.join("、"))}" placeholder="写下来"${extras.length ? "" : " hidden"}> `
    : "";
  const hint = field.hint ? `<p class="hint">${esc(field.hint)}</p>` : "";
  return `<div class="field" data-field="${esc(field.name)}" data-type="${esc(field.type)}">
    <div class="field-label" id="${esc(labelId)}">${esc(field.label)}</div>
    ${hint}
    <div class="choices" role="group" aria-labelledby="${esc(labelId)}">${options}${other}</div>
  </div>`;
}

function fieldHTML(section, field, value, rowKey) {
  if (field.type === "single_choice" || field.type === "multi_choice") {
    return choiceHTML(section, field, value, rowKey);
  }
  const labelId = fieldId(section, rowKey, field.name);
  const hint = field.hint ? `<p class="hint">${esc(field.hint)}</p>` : "";
  if (field.type === "textarea") {
    return `<div class="field" data-field="${esc(field.name)}" data-type="textarea">
      <label for="${esc(labelId)}"><span class="field-label">${esc(field.label)}</span></label>
      ${hint}
      <textarea id="${esc(labelId)}" rows="${rowsFor(field)}">${esc(value ?? "")}</textarea>
    </div>`;
  }
  if (field.type === "number") {
    const unset = value === "" || value == null;
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const rangeValue = unset ? min : value;
    const unit = field.unit ? `<span class="unit">${esc(field.unit)}</span>` : "";
    return `<div class="field${unset ? " is-unset" : ""}" data-field="${esc(field.name)}" data-type="number">
      <div class="field-label" id="${esc(labelId)}">${esc(field.label)}</div>
      ${hint}
      <div class="score-control">
        <input type="range" min="${esc(min)}" max="${esc(max)}" step="1" value="${esc(rangeValue)}" aria-labelledby="${esc(labelId)}"${unset ? ' aria-valuetext="未填"' : ""}>
        <input class="score-num" type="number" inputmode="numeric" min="${esc(min)}" max="${esc(max)}" step="1" placeholder="—" aria-labelledby="${esc(labelId)}" value="${unset ? "" : esc(value)}">
        ${unit}
      </div>
    </div>`;
  }
  const inputType = field.type === "datetime" ? "datetime-local" : field.type === "time" ? "time" : field.type === "date" ? "date" : "text";
  return `<div class="field" data-field="${esc(field.name)}" data-type="${esc(field.type)}">
    <label for="${esc(labelId)}"><span class="field-label">${esc(field.label)}</span></label>
    ${hint}
    <input id="${esc(labelId)}" type="${inputType}" value="${esc(value ?? "")}">
  </div>`;
}

export function fieldsHTML(section, row, rowKey) {
  return section.fields.map((field) => fieldHTML(section, field, row?.[field.name], rowKey)).join("");
}

export function rowHTML(section, row, rowKey) {
  const remove = section.repeatable
    ? `<button type="button" class="btn btn-quiet" data-action="remove-row">删除这条</button>`
    : "";
  return `<div class="row">${fieldsHTML(section, row, rowKey)}${remove}</div>`;
}

export function formHTML(worksheet, values) {
  return (worksheet.sections || [])
    .map((section) => {
      if (section.repeatable) {
        const rows = Array.isArray(values?.[section.id]) && values[section.id].length
          ? values[section.id]
          : [blankRow(section)];
        const html = rows.map((row, index) => rowHTML(section, row, index)).join("");
        return `<section class="block" data-section-id="${esc(section.id)}" data-repeatable="1">
          <h2>${esc(section.title)}</h2>
          <div class="rows">${html}</div>
          <button type="button" class="btn btn-secondary" data-action="add-row">再加一条</button>
        </section>`;
      }
      const row = values?.[section.id] || blankRow(section);
      return `<section class="block" data-section-id="${esc(section.id)}">
        <h2>${esc(section.title)}</h2>
        ${fieldsHTML(section, row, 0)}
      </section>`;
    })
    .join("");
}

export function readFields(section, container) {
  const row = {};
  for (const field of section.fields) {
    const wrap = container.querySelector(`[data-field="${CSS.escape(field.name)}"]`);
    row[field.name] = readField(field, wrap);
  }
  return row;
}

function readField(field, wrap) {
  if (!wrap) {
    if (field.type === "multi_choice") return [];
    return "";
  }
  if (field.type === "multi_choice") {
    const selected = [...wrap.querySelectorAll("input[type='checkbox'][data-opt]:checked")].map((input) => input.value);
    const toggle = wrap.querySelector("[data-other-toggle]");
    const other = wrap.querySelector("[data-other-text]");
    if (toggle?.checked && other?.value.trim()) selected.push(other.value.trim());
    return selected;
  }
  if (field.type === "single_choice") {
    return wrap.querySelector("input[type='radio']:checked")?.value || "";
  }
  if (field.type === "number") {
    const input = wrap.querySelector("input[type='number']");
    if (!input || input.value === "") return "";
    const n = asNumber(input.value);
    return n == null ? "" : n;
  }
  const input = wrap.querySelector("input, textarea");
  return input ? input.value : "";
}

export function readForm(worksheet, root) {
  const values = {};
  for (const section of worksheet.sections || []) {
    const sectionEl = root.querySelector(`[data-section-id="${CSS.escape(section.id)}"]`);
    if (!sectionEl) {
      values[section.id] = section.repeatable ? [] : blankRow(section);
      continue;
    }
    if (section.repeatable) {
      values[section.id] = [...sectionEl.querySelectorAll(":scope > .rows > .row")]
        .map((rowEl) => readFields(section, rowEl))
        .filter((row) => !isRowEmpty(section, row));
    } else {
      values[section.id] = readFields(section, sectionEl);
    }
  }
  return values;
}

function viewValue(field, value) {
  if (Array.isArray(value)) {
    if (!value.length) return `<span class="muted">未填</span>`;
    return `<span class="chips">${value.map((item) => `<span class="chip">${esc(item)}</span>`).join("")}</span>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${esc(value)}${field.unit ? esc(field.unit) : ""}`;
  }
  if (value == null || value === "") return `<span class="muted">未填</span>`;
  if (field.type === "datetime") return esc(String(value).replace("T", " "));
  return esc(value);
}

export function viewHTML(worksheet, values) {
  return (worksheet.sections || [])
    .map((section) => {
      const source = values?.[section.id];
      const rows = section.repeatable ? (Array.isArray(source) ? source : []) : [source || {}];
      const meaningful = rows.filter((row) => !isRowEmpty(section, row));
      const body = meaningful.length
        ? meaningful
            .map((row, index) => {
              const fields = section.fields
                .map(
                  (field) =>
                    `<div class="view-field"><div class="k">${esc(field.label)}</div><div class="v">${viewValue(field, row?.[field.name])}</div></div>`,
                )
                .join("");
              return section.repeatable ? `<div class="row-view"><p class="row-index">第 ${index + 1} 条</p>${fields}</div>` : fields;
            })
            .join("")
        : `<p class="muted">未填</p>`;
      return `<section class="block"><h2>${esc(section.title)}</h2>${body}</section>`;
    })
    .join("");
}

export function validateNumbers(worksheet, values) {
  const errors = [];
  for (const section of worksheet.sections || []) {
    const rows = section.repeatable ? values[section.id] || [] : [values[section.id] || {}];
    for (const row of rows) {
      for (const field of section.fields) {
        if (field.type !== "number") continue;
        const n = asNumber(row?.[field.name]);
        if (n == null) continue;
        if ((field.min != null && n < field.min) || (field.max != null && n > field.max)) {
          errors.push(`${field.label}要在 ${field.min} 和 ${field.max} 之间`);
        }
      }
    }
  }
  return errors;
}
