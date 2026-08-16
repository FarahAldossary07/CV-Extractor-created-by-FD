/* CV Extractor — created by FD
   All parsing happens in the browser. Optional AI mode calls the Claude API
   with the user's own key. */

"use strict";

/* ---------------------------------------------------------------- state */

const files = []; // { id, name, file, text, status }
let results = null; // { columns: [...], rows: [{...}] }
let nextId = 1;

const $ = (sel) => document.querySelector(sel);

const dropzone = $("#dropzone");
const fileInput = $("#file-input");
const fileList = $("#file-list");
const chipRow = $("#chip-row");
const freeformInput = $("#freeform-input");
const extractBtn = $("#extract-btn");
const statusLine = $("#status-line");
const aiToggle = $("#ai-toggle");
const keyRow = $("#key-row");
const apiKeyInput = $("#api-key-input");

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
}

/* ---------------------------------------------------------- file intake */

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
);
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

function addFiles(list) {
  for (const f of list) {
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["pdf", "docx", "doc", "txt", "rtf", "md"].includes(ext)) continue;
    const entry = { id: nextId++, name: f.name, file: f, text: null, status: "reading…" };
    files.push(entry);
    renderFileList();
    readFile(entry);
  }
  updateExtractBtn();
}

async function readFile(entry) {
  try {
    const ext = entry.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      entry.text = await readPdf(entry.file);
    } else if (ext === "docx") {
      const buf = await entry.file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: buf });
      entry.text = res.value;
    } else {
      entry.text = await entry.file.text();
    }
    entry.text = (entry.text || "").replace(/\r/g, "");
    if (!entry.text.trim()) throw new Error("no readable text");
    entry.status = "ready";
  } catch (err) {
    console.error("Failed to read", entry.name, err);
    entry.status = "couldn’t read";
    entry.text = null;
  }
  renderFileList();
  updateExtractBtn();
}

async function readPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let line = [];
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 4) {
        parts.push(line.join(" "));
        line = [];
      }
      if (item.str.trim()) line.push(item.str);
      lastY = y;
    }
    parts.push(line.join(" "));
    parts.push("");
  }
  return parts.join("\n");
}

function renderFileList() {
  fileList.innerHTML = "";
  for (const entry of files) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = entry.name;
    const status = document.createElement("span");
    status.className = "file-status" +
      (entry.status === "ready" ? " ok" : entry.status === "couldn’t read" ? " err" : "");
    status.textContent = entry.status;
    const remove = document.createElement("button");
    remove.className = "file-remove";
    remove.setAttribute("aria-label", `Remove ${entry.name}`);
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      files.splice(files.indexOf(entry), 1);
      renderFileList();
      updateExtractBtn();
    });
    li.append(name, status, remove);
    fileList.append(li);
  }
}

/* ------------------------------------------------------- field choosing */

chipRow.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  chip.classList.toggle("selected");
  updateExtractBtn();
});

$("#freeform-apply").addEventListener("click", applyFreeform);
freeformInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFreeform(); });

function applyFreeform() {
  const parsed = parseFieldRequest(freeformInput.value);
  if (!parsed.length) return;
  // Deselect everything, then select matching chips and add new ones for the rest
  const chips = [...chipRow.querySelectorAll(".chip")];
  chips.forEach((c) => c.classList.remove("selected"));
  for (const field of parsed) {
    const existing = chips.find(
      (c) => normalizeField(c.dataset.field) === normalizeField(field)
    );
    if (existing) {
      existing.classList.add("selected");
      chipRow.append(existing); // reorder to match the request
    } else {
      const chip = document.createElement("button");
      chip.className = "chip selected";
      chip.dataset.field = field;
      chip.textContent = field;
      chipRow.append(chip);
      chips.push(chip);
    }
  }
  updateExtractBtn();
}

function parseFieldRequest(text) {
  if (!text.trim()) return [];
  let t = text
    .replace(/^\s*(i\s+want|i\s+need|give\s+me|extract|get\s+me|please)\b/gi, "")
    .replace(/\b(please|for\s+each\s+(cv|candidate)|from\s+(the\s+)?cvs?)\b/gi, "");
  const parts = t
    .split(/,|;|\band\b|\bplus\b|\n/gi)
    .map((s) => s.trim().replace(/^["'\-•\s]+|["'\-•\s.]+$/g, ""))
    .filter((s) => s.length > 0 && s.length < 60);
  // Capitalize first letter of each field for column headers
  return [...new Set(parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)))];
}

function selectedFields() {
  return [...chipRow.querySelectorAll(".chip.selected")].map((c) => c.dataset.field);
}

function normalizeField(f) {
  return f.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------- AI panel */

aiToggle.addEventListener("change", () => {
  keyRow.hidden = !aiToggle.checked;
  $("#ai-footnote").hidden = !aiToggle.checked;
  if (aiToggle.checked && localStorage.getItem("cvx_api_key")) {
    apiKeyInput.value = localStorage.getItem("cvx_api_key");
  }
  updateExtractBtn();
});

apiKeyInput.addEventListener("input", () => {
  localStorage.setItem("cvx_api_key", apiKeyInput.value.trim());
  updateExtractBtn();
});

/* ------------------------------------------------------------ extraction */

function updateExtractBtn() {
  const ready = files.some((f) => f.status === "ready") &&
    files.every((f) => f.status !== "reading…");
  const hasFields = selectedFields().length > 0;
  const aiOk = !aiToggle.checked || apiKeyInput.value.trim().length > 10;
  extractBtn.disabled = !(ready && hasFields && aiOk);
}

extractBtn.addEventListener("click", runExtraction);

async function runExtraction() {
  const columns = selectedFields();
  const readyFiles = files.filter((f) => f.status === "ready");
  extractBtn.disabled = true;
  setStatus("");

  const rows = [];
  for (let i = 0; i < readyFiles.length; i++) {
    const entry = readyFiles[i];
    setStatus(`Extracting ${i + 1} of ${readyFiles.length} — ${entry.name}`);
    let row;
    try {
      row = aiToggle.checked
        ? await extractWithAI(entry.text, columns)
        : extractLocally(entry.text, columns);
    } catch (err) {
      console.error(err);
      setStatus(`${entry.name}: ${err.message}`, true);
      row = Object.fromEntries(columns.map((c) => [c, ""]));
    }
    rows.push({ __source: entry.name, ...row });
  }

  results = { columns, rows };
  renderResults();
  setStatus(`Done — ${rows.length} candidate${rows.length === 1 ? "" : "s"} extracted.`);
  extractBtn.disabled = false;
}

function setStatus(msg, isError = false) {
  statusLine.textContent = msg;
  statusLine.classList.toggle("error", isError);
}

/* ----------------------------------------------- built-in smart parser */

function extractLocally(text, columns) {
  const row = {};
  const ctx = buildContext(text);
  for (const col of columns) {
    row[col] = routeField(normalizeField(col), ctx) || "";
  }
  return row;
}

function buildContext(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return { text, lines, lower: text.toLowerCase() };
}

function routeField(key, ctx) {
  if (/\bemail\b|e mail/.test(key)) return findEmail(ctx);
  if (/phone|mobile|contact number|telephone|cell/.test(key)) return findPhone(ctx);
  if (/first name/.test(key)) return findName(ctx).first;
  if (/last name|surname|family name/.test(key)) return findName(ctx).last;
  if (/full name|candidate name|^name$|^names$/.test(key)) return findName(ctx).full;
  if (/nationality|citizenship/.test(key)) return findNationality(ctx);
  if (/years? of experience|experience years|yrs of experience|years experience/.test(key)) return findYearsExperience(ctx);
  if (/linkedin/.test(key)) return findLinkedIn(ctx);
  if (/location|address|city|country of residence/.test(key)) return findLabeled(ctx, ["address", "location", "city", "residence", "based in"]);
  if (/education|degree|qualification|university/.test(key)) return findEducation(ctx);
  if (/skill/.test(key)) return findSection(ctx, ["skills", "technical skills", "core competencies", "key skills", "areas of expertise"]);
  if (/language/.test(key)) return findLanguages(ctx);
  if (/job title|current (job|title|position|role)|position|title|role|occupation|profession/.test(key)) return findJobTitle(ctx);
  if (/date of birth|dob|birth/.test(key)) return findLabeled(ctx, ["date of birth", "dob", "born"]);
  if (/gender|sex/.test(key)) return findLabeled(ctx, ["gender", "sex"]);
  if (/marital/.test(key)) return findLabeled(ctx, ["marital status"]);
  if (/website|portfolio|github/.test(key)) return findUrl(ctx, key);
  // Unknown field: try a generic "Label: value" lookup
  return findLabeled(ctx, [key]);
}

function findEmail(ctx) {
  const m = ctx.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : "";
}

function findPhone(ctx) {
  // International and local formats: +966 5x xxx xxxx, (555) 123-4567, 05xxxxxxxx …
  const candidates = ctx.text.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,4}/g) || [];
  for (const c of candidates) {
    const digits = c.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) {
      // Avoid matching date ranges like 2015 - 2020
      if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(c.trim())) continue;
      return c.trim();
    }
  }
  return "";
}

const NAME_STOPWORDS = /curriculum|vitae|resume|résumé|cv\b|profile|contact|summary|objective|address|phone|email|www|http/i;

function findName(ctx) {
  // 1) Labeled
  const labeled = findLabeled(ctx, ["name", "full name", "candidate name"]);
  let full = "";
  if (labeled && labeled.split(/\s+/).length <= 5 && !/@|\d/.test(labeled)) full = labeled;

  // 2) Top-of-document heuristic: first line that looks like a person's name
  if (!full) {
    for (const line of ctx.lines.slice(0, 8)) {
      if (NAME_STOPWORDS.test(line)) continue;
      if (/@|\d|http/.test(line)) continue;
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && words.length <= 4 &&
          words.every((w) => /^[A-Za-zÀ-ÿ'’.-]+$/.test(w))) {
        full = line.replace(/\s+/g, " ");
        break;
      }
    }
  }

  // 3) Fall back to email prefix: jane.doe@x.com → Jane Doe
  if (!full) {
    const email = findEmail(ctx);
    if (email) {
      const guess = email.split("@")[0].replace(/\d+/g, "").split(/[._-]/).filter(Boolean);
      if (guess.length >= 2) {
        full = guess.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    }
  }

  const parts = full.split(/\s+/).filter(Boolean);
  return {
    full,
    first: parts[0] || "",
    last: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

const NATIONALITIES = ["afghan","albanian","algerian","american","andorran","angolan","argentine","argentinian","armenian","australian","austrian","azerbaijani","bahraini","bangladeshi","belarusian","belgian","beninese","bhutanese","bolivian","bosnian","brazilian","british","bruneian","bulgarian","burkinabe","burmese","burundian","cambodian","cameroonian","canadian","chadian","chilean","chinese","colombian","comoran","congolese","costa rican","croatian","cuban","cypriot","czech","danish","djiboutian","dominican","dutch","ecuadorean","egyptian","emirati","english","eritrean","estonian","ethiopian","fijian","filipino","finnish","french","gabonese","gambian","georgian","german","ghanaian","greek","guatemalan","guinean","haitian","honduran","hungarian","icelandic","indian","indonesian","iranian","iraqi","irish","israeli","italian","ivorian","jamaican","japanese","jordanian","kazakhstani","kazakh","kenyan","kuwaiti","kyrgyz","laotian","latvian","lebanese","liberian","libyan","lithuanian","luxembourgish","macedonian","malagasy","malawian","malaysian","maldivian","malian","maltese","mauritanian","mauritian","mexican","moldovan","monacan","mongolian","montenegrin","moroccan","mozambican","namibian","nepalese","nepali","new zealander","nicaraguan","nigerian","nigerien","north korean","norwegian","omani","pakistani","palestinian","panamanian","paraguayan","peruvian","philippine","polish","portuguese","qatari","romanian","russian","rwandan","salvadoran","saudi","saudi arabian","scottish","senegalese","serbian","singaporean","slovak","slovakian","slovenian","somali","south african","south korean","korean","spanish","sri lankan","sudanese","surinamese","swazi","swedish","swiss","syrian","taiwanese","tajik","tanzanian","thai","togolese","tunisian","turkish","turkmen","ugandan","ukrainian","uruguayan","uzbek","venezuelan","vietnamese","welsh","yemeni","zambian","zimbabwean"];

function findNationality(ctx) {
  const labeled = findLabeled(ctx, ["nationality", "citizenship"]);
  if (labeled) return labeled;
  // Scan for a demonym as a standalone word (longest match first)
  const sorted = [...NATIONALITIES].sort((a, b) => b.length - a.length);
  for (const nat of sorted) {
    const re = new RegExp(`\\b${nat.replace(/ /g, "\\s+")}\\b`, "i");
    const m = ctx.lower.match(re);
    if (m) return m[0].replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "";
}

function findYearsExperience(ctx) {
  // 1) Stated outright: "8+ years of experience", "over 5 yrs experience"
  const stated = ctx.lower.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:professional\s+|work(?:ing)?\s+|relevant\s+)?experience/);
  if (stated) return stated[1] + (ctx.lower.includes(stated[1] + "+") ? "+" : "");
  const stated2 = ctx.lower.match(/experience\s*[:\-]?\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/);
  if (stated2) return stated2[1];

  // 2) Estimate from employment date ranges: earliest start year → latest end
  const now = new Date().getFullYear();
  const ranges = [...ctx.text.matchAll(/\b(19[89]\d|20[0-2]\d)\s*[-–—to]+\s*((?:19[89]\d|20[0-2]\d)|present|current|now|date)\b/gi)];
  if (ranges.length) {
    let earliest = Infinity, latest = 0;
    for (const r of ranges) {
      const start = parseInt(r[1], 10);
      const end = /present|current|now|date/i.test(r[2]) ? now : parseInt(r[2], 10);
      if (start >= 1980 && start <= now) {
        earliest = Math.min(earliest, start);
        latest = Math.max(latest, end);
      }
    }
    if (earliest !== Infinity && latest >= earliest) {
      const yrs = latest - earliest;
      if (yrs >= 0 && yrs < 50) return `~${yrs}`;
    }
  }
  return "";
}

function findLinkedIn(ctx) {
  const m = ctx.text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[A-Za-z0-9\-_/.%]+/i);
  return m ? m[0].replace(/[.,;)]+$/, "") : "";
}

function findUrl(ctx, key) {
  if (/github/.test(key)) {
    const m = ctx.text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9\-_/.]+/i);
    return m ? m[0] : "";
  }
  const m = ctx.text.match(/https?:\/\/[^\s,;)]+/);
  return m ? m[0] : "";
}

function findLabeled(ctx, labels) {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–|]\\s*(.+)$`, "im");
    const m = ctx.text.match(re);
    if (m && m[1].trim()) return m[1].trim().replace(/\s{2,}/g, " ").slice(0, 120);
  }
  return "";
}

const DEGREE_RE = /\b(ph\.?d|doctorate|m\.?sc|msc|m\.?a\b|mba|master(?:'?s)?|b\.?sc|bsc|b\.?a\b|b\.?eng|bachelor(?:'?s)?|diploma|associate degree)\b/i;

function findEducation(ctx) {
  for (const line of ctx.lines) {
    if (DEGREE_RE.test(line) && line.length < 140) return line;
  }
  return findSection(ctx, ["education", "academic background", "qualifications"]);
}

const SECTION_HEADERS = /^(experience|work experience|employment|education|skills|technical skills|projects|certifications|references|languages|summary|profile|objective|awards|interests|hobbies|contact|personal (details|information))\s*:?$/i;

function findSection(ctx, headers) {
  const lines = ctx.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/:$/, "").trim().toLowerCase();
    if (headers.some((h) => line === h || line === h + "s")) {
      const collected = [];
      for (let j = i + 1; j < lines.length && collected.length < 6; j++) {
        if (SECTION_HEADERS.test(lines[j])) break;
        collected.push(lines[j]);
      }
      return collected.join("; ").replace(/[;,\s]+$/, "").slice(0, 250);
    }
  }
  return "";
}

const LANGUAGE_NAMES = ["arabic","english","french","spanish","german","italian","portuguese","mandarin","chinese","cantonese","japanese","korean","russian","hindi","urdu","bengali","punjabi","turkish","dutch","swedish","norwegian","danish","finnish","polish","greek","hebrew","farsi","persian","tagalog","malay","indonesian","thai","vietnamese","swahili","amharic"];

function findLanguages(ctx) {
  const section = findSection(ctx, ["languages", "language skills"]);
  if (section) return section;
  const found = new Set();
  for (const lang of LANGUAGE_NAMES) {
    if (new RegExp(`\\b${lang}\\b`, "i").test(ctx.lower)) {
      found.add(lang.charAt(0).toUpperCase() + lang.slice(1));
    }
  }
  return [...found].slice(0, 6).join(", ");
}

const TITLE_WORDS = /\b(engineer|developer|manager|director|analyst|consultant|designer|architect|accountant|specialist|coordinator|officer|assistant|supervisor|technician|scientist|teacher|lecturer|nurse|physician|lawyer|auditor|administrator|executive|lead|head of [a-z]+|intern)\b/i;

function findJobTitle(ctx) {
  const labeled = findLabeled(ctx, ["job title", "current position", "position", "title", "role", "occupation"]);
  if (labeled) return labeled;
  for (const line of ctx.lines.slice(0, 12)) {
    if (TITLE_WORDS.test(line) && line.length < 80 && !/@|\d{4}/.test(line)) return line;
  }
  return "";
}

/* -------------------------------------------------------- AI extraction */

async function extractWithAI(text, columns) {
  const apiKey = apiKeyInput.value.trim();

  const properties = {};
  for (const col of columns) {
    properties[col] = {
      type: "string",
      description: `The candidate's ${col.toLowerCase()}, exactly as best determined from the CV. Empty string if not found.`,
    };
  }
  const schema = {
    type: "object",
    properties,
    required: columns,
    additionalProperties: false,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content:
            `Extract the requested details about this candidate from their CV. ` +
            `Use an empty string for anything genuinely not stated or inferable. ` +
            `For years of experience, compute from employment dates if not stated outright.\n\n` +
            `<cv>\n${text}\n</cv>`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || `API error ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("The model declined to process this document.");
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Empty response from the model.");
  const parsed = JSON.parse(textBlock.text);
  const row = {};
  for (const col of columns) row[col] = parsed[col] ?? "";
  return row;
}

/* -------------------------------------------------------------- results */

function renderResults() {
  const section = $("#station-results");
  const thead = $("#results-table thead");
  const tbody = $("#results-table tbody");
  section.hidden = false;

  const headerRow = document.createElement("tr");
  const thFile = document.createElement("th");
  thFile.textContent = "Source file";
  headerRow.append(thFile);
  for (const col of results.columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.append(th);
  }
  thead.innerHTML = "";
  thead.append(headerRow);

  tbody.innerHTML = "";
  results.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${i * 60}ms`;
    const tdFile = document.createElement("td");
    tdFile.textContent = row.__source;
    tr.append(tdFile);
    for (const col of results.columns) {
      const td = document.createElement("td");
      td.textContent = row[col] || "";
      td.contentEditable = "plaintext-only";
      td.addEventListener("input", () => { row[col] = td.textContent; });
      tr.append(td);
    }
    tbody.append(tr);
  });

  $("#results-count").textContent =
    `${results.rows.length} candidate${results.rows.length === 1 ? "" : "s"} · ${results.columns.length} column${results.columns.length === 1 ? "" : "s"}`;

  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --------------------------------------------------------------- export */

function exportRows() {
  const header = ["Source file", ...results.columns];
  const rows = results.rows.map((r) => [r.__source, ...results.columns.map((c) => r[c] || "")]);
  return { header, rows };
}

$("#export-csv").addEventListener("click", () => {
  const { header, rows } = exportRows();
  const esc = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), "candidates.csv");
});

$("#export-xlsx").addEventListener("click", () => {
  const { header, rows } = exportRows();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((h, i) => ({
    wch: Math.min(40, Math.max(h.length, ...rows.map((r) => String(r[i] || "").length)) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Candidates");
  XLSX.writeFile(wb, "candidates.xlsx");
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
