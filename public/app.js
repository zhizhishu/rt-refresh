const $ = (id) => document.getElementById(id);

let currentEntries = [];
let selected = new Set();
let importedSourceNames = [];
let lastRefreshResult = null;
let lastDownloadObjectUrl = "";
let lastOAuthStart = null;
let rawCredentialsVisible = false;
let lastRemoteCPAResult = null;
const PAGE_SIZE = 30;
let entryPage = 1;
let credentialPage = 1;
let lastCredentialItems = [];

function updateSummary() {
  const refreshable = currentEntries.filter((e) => e.has_refresh_token).length;
  const totalPages = Math.max(1, Math.ceil(currentEntries.length / PAGE_SIZE));
  $("summary").textContent = `共 ${currentEntries.length} 条，${refreshable} 条可刷新，当前选中 ${selected.size} 条。每页 ${PAGE_SIZE} 条，第 ${Math.min(entryPage, totalPages)}/${totalPages} 页。`;
}

function log(line) {
  $("log").textContent = `[${new Date().toLocaleTimeString()}] ${line}\n` + $("log").textContent;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function pageInfo(total, page) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const start = total ? (current - 1) * PAGE_SIZE : 0;
  const end = total ? Math.min(start + PAGE_SIZE, total) : 0;
  return { page: current, totalPages, start, end };
}

function renderPager(kind, total, page, { selectable = false } = {}) {
  const info = pageInfo(total, page);
  const dataAttr = kind === "credential" ? "data-credential-action" : "data-overview-action";
  const selectionControls = selectable ? `
    <button class="ghost" ${dataAttr}="select-page">全选本页可刷新</button>
    <button class="ghost" ${dataAttr}="select-all">全选全部可刷新</button>
    <button class="ghost" ${dataAttr}="select-none">全不选</button>
    <button class="ghost" ${dataAttr}="invert-page">反选本页</button>
  ` : "";
  return `
    <div class="list-toolbar" data-pager="${kind}">
      <span>第 ${info.page}/${info.totalPages} 页 · 每页 ${PAGE_SIZE} · 显示 ${total ? `${info.start + 1}-${info.end}` : "0"} / ${total}</span>
      <button class="ghost" ${dataAttr}="first" ${info.page <= 1 ? "disabled" : ""}>首页</button>
      <button class="ghost" ${dataAttr}="prev" ${info.page <= 1 ? "disabled" : ""}>上一页</button>
      <button class="ghost" ${dataAttr}="next" ${info.page >= info.totalPages ? "disabled" : ""}>下一页</button>
      <button class="ghost" ${dataAttr}="last" ${info.page >= info.totalPages ? "disabled" : ""}>末页</button>
      ${selectionControls}
      <button class="ghost" ${dataAttr}="expand-page">展开本页</button>
      <button class="ghost" ${dataAttr}="collapse-page">折叠本页</button>
    </div>`;
}

function currentPageItems(items, page) {
  const info = pageInfo(items.length, page);
  return { ...info, items: items.slice(info.start, info.end) };
}

function syncSelectionControls() {
  document.querySelectorAll(".pick, .credential-pick").forEach((box) => {
    const idx = Number(box.dataset.index);
    box.checked = selected.has(idx);
  });
  updateSummary();
}

function selectItems(items, mode) {
  if (mode === "none") {
    selected.clear();
    syncSelectionControls();
    return;
  }
  for (const item of items) {
    const idx = Number(item.index);
    const canRefresh = Boolean(item.has_refresh_token ?? item.refresh);
    if (!canRefresh) continue;
    if (mode === "select") selected.add(idx);
    if (mode === "invert") {
      if (selected.has(idx)) selected.delete(idx); else selected.add(idx);
    }
  }
  syncSelectionControls();
}

function setDetailsOpen(container, open) {
  container.querySelectorAll("details").forEach((el) => { el.open = open; });
}

async function sha256Text(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getWebGLInfo() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { supported: false };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      supported: true,
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shading_language_version: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    };
  } catch (err) {
    return { supported: false, error: err.message };
  }
}

async function getCanvasHash() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 360, 120);
    ctx.fillStyle = "#069";
    ctx.font = "18px Arial";
    ctx.fillText("rt-refresh #jshook 000 指纹采样", 12, 18);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.font = "16px serif";
    ctx.fillText("Codex/Claude CTF browser probe", 12, 52);
    return await sha256Text(canvas.toDataURL());
  } catch (err) {
    return `error:${err.message}`;
  }
}

async function collectFingerprint() {
  const uaData = navigator.userAgentData ? {
    brands: navigator.userAgentData.brands,
    mobile: navigator.userAgentData.mobile,
    platform: navigator.userAgentData.platform,
    high_entropy: await navigator.userAgentData.getHighEntropyValues([
      "architecture", "bitness", "model", "platformVersion", "uaFullVersion", "fullVersionList", "wow64",
    ]).catch((err) => ({ error: err.message })),
  } : null;
  const server = await fetch("/api/fingerprint", { cache: "no-store" }).then((r) => r.json());
  const browser = {
    collected_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    user_agent_data: uaData,
    language: navigator.language,
    languages: navigator.languages,
    platform: navigator.platform,
    cookie_enabled: navigator.cookieEnabled,
    do_not_track: navigator.doNotTrack,
    hardware_concurrency: navigator.hardwareConcurrency,
    device_memory_gb: navigator.deviceMemory,
    max_touch_points: navigator.maxTouchPoints,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset_minutes: new Date().getTimezoneOffset(),
    screen: {
      width: screen.width,
      height: screen.height,
      avail_width: screen.availWidth,
      avail_height: screen.availHeight,
      color_depth: screen.colorDepth,
      pixel_depth: screen.pixelDepth,
      device_pixel_ratio: window.devicePixelRatio,
    },
    viewport: {
      inner_width: window.innerWidth,
      inner_height: window.innerHeight,
      outer_width: window.outerWidth,
      outer_height: window.outerHeight,
    },
    webgl: getWebGLInfo(),
    canvas_sha256: await getCanvasHash(),
  };
  const payload = {
    scope: "browser-visible fingerprint + server-observed request headers",
    ctf_authorization: "NV CTF / #jshook 000",
    browser,
    server_seen_request: server,
    cli_limitations: {
      can_browser_read_codex_cli_files: false,
      can_browser_read_claude_cli_files: false,
      can_browser_read_local_processes_or_telemetry_cache: false,
      how_to_collect_cli_info: "让 Codex/Claude CLI 或本地 companion 主动请求 /api/fingerprint，或手动上传/粘贴脱敏诊断数据。",
    },
    reference_fields: {
      claude_device_profile_headers: ["User-Agent", "X-Stainless-Package-Version", "X-Stainless-Runtime-Version", "X-Stainless-Os", "X-Stainless-Arch"],
      codex_headers_seen_in_reference: ["User-Agent", "Originator", "OpenAI-Beta", "ChatGPT-Account-ID"],
    },
  };
  $("fingerprintOutput").value = pretty(payload);
  log("已采集浏览器可见指纹和服务端请求头。CLI 本机信息需 CLI/本地 companion 主动提供。");
}

async function refreshCaptures() {
  const data = await fetch("/api/captures", { cache: "no-store" }).then((r) => r.json());
  $("capturesOutput").value = pretty(data);
  log(`已刷新捕获列表：${data.count || 0} 条。`);
}

async function clearCaptures() {
  const resp = await fetch("/api/captures", { method: "DELETE" }).then((r) => r.json());
  $("capturesOutput").value = pretty(resp);
  log("已清空服务端内存捕获。");
}

function downloadCaptures() {
  const text = $("capturesOutput").value.trim();
  if (!text) return log("还没有捕获 JSON。");
  clickDownload(text, `rt-refresh-captures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function safeFileName(name, fallback = "codex-auth") {
  const base = String(name || fallback).replace(/\.jsonl?$/i, "").replace(/[^a-zA-Z0-9@._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || fallback).slice(0, 120);
}

function candidateNameFromEntry(entry) {
  return entry?.name || entry?.label || entry?.email || entry?.account_id ||
    entry?.credentials?.name || entry?.credentials?.email || entry?.credentials?.account_id ||
    entry?.profile?.email || "";
}

function sourceNameForImportedEntry(fileName, entry, flatIndex = 0, flatCount = 1) {
  const fileBase = safeFileName(fileName, "codex-auth");
  const entryName = safeFileName(candidateNameFromEntry(entry), "");
  if (flatCount <= 1) return entryName || fileBase;
  return entryName ? `${fileBase}-${entryName}` : `${fileBase}-${flatIndex + 1}`;
}

function clickDownload(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  clickDownloadBlob(blob, filename);
}

function clickDownloadBlob(blob, filename) {
  if (lastDownloadObjectUrl) URL.revokeObjectURL(lastDownloadObjectUrl);
  const url = URL.createObjectURL(blob);
  lastDownloadObjectUrl = url;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  const fallback = $("downloadFallback");
  if (fallback) {
    fallback.style.display = "block";
    fallback.innerHTML = `如果浏览器没有自动下载，<a href="${url}" download="${escapeHTML(filename)}">点这里手动下载 ${escapeHTML(filename)}</a>`;
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function u16(v) {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v) {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.text);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(day),
      ...u32(crc), ...u32(dataBytes.length), ...u32(dataBytes.length), ...u16(nameBytes.length), ...u16(0),
    ]);
    const centralHeader = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(day),
      ...u32(crc), ...u32(dataBytes.length), ...u32(dataBytes.length), ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]);
    localParts.push(localHeader, nameBytes, dataBytes);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.byteLength + nameBytes.byteLength + dataBytes.byteLength;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}

function downloadJsonZip(items, zipName, fallbackPrefix = "codex") {
  const used = new Map();
  const files = items.map((item, i) => {
    const base = safeFileName(item.name, `${fallbackPrefix}-${i + 1}`);
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);
    const filename = seen ? `${base}-${seen + 1}.json` : `${base}.json`;
    return { name: filename, text: pretty(item.value) };
  });
  clickDownloadBlob(makeZip(files), zipName);
  return files.length;
}

async function api(path, payload) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok && !data.results) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

async function loadConfig() {
  const cfg = await fetch("/api/config").then((r) => r.json());
  $("tokenUrl").value = cfg.token_url;
  $("clientId").value = cfg.client_id;
  $("scope").value = cfg.scope;
  $("oauthOutput").value = pretty({
    codex_oauth: {
      auth_url: cfg.oauth_auth_url,
      token_url: cfg.oauth_token_url,
      client_id: cfg.client_id,
      default_scope: "openid email profile offline_access",
      callback: `${location.origin}/oauth/callback`,
    },
    api: [
      "GET /api/oauth/start",
      "GET /oauth/callback",
      "POST /api/oauth/exchange",
      "GET /api/oauth/latest",
      "GET /api/oauth/download/latest",
    ],
  });
  if (cfg.capture_redact === false) log("CTF 原文捕获模式已开启：服务端不会脱敏捕获字段。");
}

function renderEntries(entries) {
  currentEntries = entries;
  selected = new Set(entries.filter((e) => e.has_refresh_token).map((e) => e.index));
  entryPage = 1;
  renderEntryPage();
}

function accountOverviewStats() {
  const refreshable = currentEntries.filter((e) => e.has_refresh_token).length;
  const withAccess = currentEntries.filter((e) => e.has_access_token).length;
  const withId = currentEntries.filter((e) => e.has_id_token).length;
  const planCounts = new Map();
  for (const e of currentEntries) {
    if (!e.plan_type) continue;
    planCounts.set(e.plan_type, (planCounts.get(e.plan_type) || 0) + 1);
  }
  const credentialItems = getCredentialItemsFromInput();
  const quota5hKnown = credentialItems.filter((item) => item.quota.hasAny).length;
  const quotaWeekKnown = credentialItems.filter((item) => item.weekly.hasAny).length;
  const planText = [...planCounts.entries()].slice(0, 5).map(([k, v]) => `${k}:${v}`).join(" · ") || "unknown";
  return `
    <div class="overview-stats">
      <span>可刷新 ${refreshable}/${currentEntries.length}</span>
      <span>AT ${withAccess}</span>
      <span>ID ${withId}</span>
      <span>5h 字段 ${quota5hKnown}</span>
      <span>周限额字段 ${quotaWeekKnown}</span>
      <span>plan ${escapeHTML(planText)}</span>
    </div>`;
}

function renderEntryPage() {
  updateSummary();
  const target = $("entries");
  if (!currentEntries.length) {
    target.innerHTML = `<div class="hint">还没解析。宝宝，别指望空 JSON 自己分页。</div>`;
    return;
  }
  const page = currentPageItems(currentEntries, entryPage);
  entryPage = page.page;
  target.innerHTML = `
    ${accountOverviewStats()}
    ${renderPager("overview", currentEntries.length, entryPage, { selectable: true })}
    <div class="entries-page">
      ${page.items.map((e) => `
        <details class="entry-detail">
          <summary>
            <input type="checkbox" class="pick" data-index="${e.index}" ${selected.has(e.index) ? "checked" : ""} ${e.has_refresh_token ? "" : "disabled"} />
            <span class="entry-title"><b>${escapeHTML(e.label)}</b><small>src ${escapeHTML(importedSourceNames[e.index] || `#${e.index + 1}`)}</small></span>
            <span class="badge ${e.has_refresh_token ? "ok" : "warn"}">${e.has_refresh_token ? "RT OK" : "NO RT"}</span>
            ${e.plan_type ? `<span class="badge">${escapeHTML(e.plan_type)}</span>` : ""}
          </summary>
          <div class="entry-extra">
            <span>AT#</span><code>${escapeHTML(e.access_fingerprint || "none")}</code>
            <span>RT#</span><code>${escapeHTML(e.refresh_fingerprint || "none")}</code>
            <span>email</span><code>${escapeHTML(e.email || "unknown")}</code>
            <span>account</span><code>${escapeHTML(e.account_id || "unknown")}</code>
            <span>user</span><code>${escapeHTML(e.user_id || "unknown")}</code>
            <span>org</span><code>${escapeHTML(e.organization_id || "unknown")}</code>
            <span>expires</span><code>${escapeHTML(e.expires_at || "unknown")}</code>
            <span>warnings</span><code>${escapeHTML((e.warnings || []).join(", ") || "none")}</code>
          </div>
        </details>`).join("")}
    </div>
    ${renderPager("overview", currentEntries.length, entryPage, { selectable: true })}`;
  target.querySelectorAll(".pick").forEach((box) => {
    box.addEventListener("click", (ev) => ev.stopPropagation());
    box.addEventListener("change", () => {
      const idx = Number(box.dataset.index);
      if (box.checked) selected.add(idx); else selected.delete(idx);
      syncSelectionControls();
    });
  });
  target.querySelectorAll("[data-overview-action]").forEach((button) => {
    button.addEventListener("click", () => handleOverviewAction(button.dataset.overviewAction, target));
  });
}

function handleOverviewAction(action, target) {
  const page = currentPageItems(currentEntries, entryPage);
  if (action === "first") entryPage = 1;
  if (action === "prev") entryPage = Math.max(1, entryPage - 1);
  if (action === "next") entryPage = Math.min(page.totalPages, entryPage + 1);
  if (action === "last") entryPage = page.totalPages;
  if (action === "select-page") return selectItems(page.items, "select");
  if (action === "select-all") return selectItems(currentEntries, "select");
  if (action === "select-none") return selectItems(currentEntries, "none");
  if (action === "invert-page") return selectItems(page.items, "invert");
  if (action === "expand-page") return setDetailsOpen(target, true);
  if (action === "collapse-page") return setDetailsOpen(target, false);
  renderEntryPage();
}


function flattenClientInput(value) {
  if (Array.isArray(value)) return value.flatMap(flattenClientInput);
  if (value && typeof value === "object") {
    for (const key of ["accounts", "items", "data"]) {
      if (Array.isArray(value[key])) return value[key].flatMap(flattenClientInput);
    }
  }
  return [value];
}

function parseCredentialText(text, name = "input") {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (isRefreshTokenLine(trimmed)) return [rawRefreshTokenToAuth(trimmed, 0)];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return [JSON.parse(trimmed)]; } catch (err) { throw new Error(`${name} 不是合法 JSON: ${err.message}`); }
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line, i) => {
    const cleaned = cleanTokenLine(line);
    if (isRefreshTokenLine(cleaned)) return rawRefreshTokenToAuth(cleaned, i);
    try { return JSON.parse(line); } catch (err) { throw new Error(`${name} 第 ${i + 1} 行不是合法 JSON，也不是 rt 开头的 RT: ${err.message}`); }
  });
}

function cleanTokenLine(line) {
  return String(line || "").trim().replace(/^[`'"]+|[`'",;]+$/g, "");
}

function isRefreshTokenLine(line) {
  return /^rt[\w.-]{3,}$/i.test(cleanTokenLine(line));
}

function rawRefreshTokenToAuth(line, index) {
  return {
    type: "codex",
    refresh_token: cleanTokenLine(line),
    label: `rt-${index + 1}`,
    client_id: $("clientId").value.trim() || "app_EMoamEEZ73f0CkXaXp7hrann",
  };
}

async function importFiles(fileList) {
  const files = [...fileList].filter((file) => /\.(jsonl?|txt)$/i.test(file.name) || file.type === "application/json" || file.type === "text/plain");
  if (!files.length) return log("没有可导入的 JSON/JSONL/TXT 文件。拖了个寂寞？");
  const docs = [];
  importedSourceNames = [];
  for (const file of files) {
    const text = await file.text();
    const parsed = parseCredentialText(text, file.name);
    parsed.forEach((doc, i) => {
      docs.push(doc);
      const flattened = flattenClientInput(doc);
      flattened.forEach((entry, j) => {
        const base = sourceNameForImportedEntry(file.name, entry, j, flattened.length);
        importedSourceNames.push(parsed.length === 1 ? base : `${base}-${i + 1}`);
      });
    });
  }
  $("input").value = pretty(docs.length === 1 ? docs[0] : docs);
  const importedScope = docs.find((doc) => typeof doc?.scope === "string" && doc.scope.trim())?.scope?.trim();
  if (importedScope && ["", "openid profile email"].includes($("scope").value.trim())) {
    $("scope").value = importedScope;
    log(`已使用导入文件里的 scope: ${importedScope}`);
  }
  log(`已导入 ${files.length} 个文件，合并为 ${docs.length} 个 JSON 文档。`);
  await analyze();
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function analyze() {
  const input = $("input").value.trim();
  if (!input) return log("没有输入，解析空气呢？");
  const result = await api("/api/analyze", { input });
  if (importedSourceNames.length !== result.entries.length) importedSourceNames = result.entries.map((_, i) => `entry-${i + 1}.json`);
  renderEntries(result.entries);
  renderCredentialDetails(false);
  log(`解析完成：${result.count} 条，${result.refreshable} 条包含 RT。`);
}

async function refresh() {
  const input = $("input").value.trim();
  if (!input) return log("没有 CPA JSON，刷新个寂寞。");
  if (!currentEntries.length) await analyze();
  if (!selected.size) return log("没有选中可刷新条目。");
  $("refresh").disabled = true;
  $("refresh").textContent = "刷新中...";
  try {
    const result = await api("/api/refresh", {
      input,
      options: {
        token_url: $("tokenUrl").value.trim(),
        client_id: $("clientId").value.trim(),
        scope: $("scope").value.trim(),
        user_agent: $("ua").value.trim(),
        request_interval_ms: Number($("requestInterval").value || 0),
        retry_attempts: Number($("retryAttempts").value || 1),
        retry_backoff_ms: Number($("retryBackoff").value || 1000),
        exclusive: $("exclusive").checked,
        canonical_only: $("canonical").checked,
        selected_indices: [...selected],
      },
    });
    lastRefreshResult = result;
    $("output").value = pretty(result.exported);
    const okRows = result.results.filter((r) => r.ok);
    const failRows = result.results.filter((r) => r.ok === false);
    const skippedRows = result.results.filter((r) => r.skipped);
    const skippedCount = Number(result.skipped ?? skippedRows.length);
    for (const r of failRows) log(`FAIL #${r.index}: ${r.error}`);
    for (const r of okRows) log(`OK #${r.index}: AT#${r.access_fingerprint} RT#${r.refresh_fingerprint} attempts=${r.attempts || 1} ${r.rotated_refresh_token ? "返回新RT，旧RT可能失效" : "未返回新RT，旧RT不会因此失效"}`);
    if (skippedCount) log(`SKIP 汇总：${skippedCount} 条未选中，未刷新。`);
    log(`完成：成功 ${result.refreshed}，失败 ${result.failed}，跳过 ${skippedCount}，间隔=${result.request_interval_ms}ms，总尝试=${result.retry_attempts}，exclusive=${result.exclusive}`);
  } finally {
    $("refresh").disabled = false;
    $("refresh").textContent = "刷新 RT 并生成导出";
  }
}

function sample() {
  $("input").value = pretty({
    accounts: [
      {
        name: "ctf-codex-account",
        credentials: {
          access_token: "eyJ.mock.old-at",
          refresh_token: "rt_mock_please_replace",
          id_token: "eyJ.mock.id",
          expires_at: "2026-06-17T00:00:00Z",
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann"
        }
      }
    ]
  });
  log("样例已填充，记得换成你的 CTF JSON。");
}

function download() {
  const text = $("output").value.trim();
  if (!text) return log("没有导出内容。");
  clickDownload(text, `rt-refresh-merged-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function downloadEachRefreshed() {
  if (lastRefreshResult?.canonical?.length) {
    const okResults = lastRefreshResult.results.filter((r) => r.ok);
    let docs = [];
    try { docs = currentImportedDocs(); } catch {}
    const items = lastRefreshResult.canonical.map((item, i) => {
      const result = okResults[i] || {};
      const original = docs[result.index];
      const value = original ? { ...canonicalMetadataFromEntry(original), ...item } : item;
      const source = importedSourceNames[result.index] || result.label || candidateNameFromEntry(item) || `codex-${i + 1}`;
      return { name: source, value };
    });
    const count = downloadJsonZip(items, `rt-refresh-refreshed-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, "codex");
    log(`已打包 ${count} 个刷新后单账号 JSON 到 ZIP，并生成备用下载链接。文件名按 CPA 原始文件名/账号名扁平化。`);
    return;
  }
  if (lastRefreshResult && !lastRefreshResult.canonical?.length) {
    return log("本轮刷新成功 0 个，没有刷新后的单账号 JSON 可下载。旧 RT 已失败就别硬装新凭证了。");
  }
  log("还没有刷新结果。先点“刷新 RT 并生成导出”；如果只是备份旧文件，请点“下载导入原始单账号JSON”。");
}

function downloadEachImported() {
  const input = $("input").value.trim();
  if (!input) return log("没有可下载内容。先导入 JSON。");
  let docs;
  try {
    docs = flattenClientInput(parseCredentialText(input));
  } catch (err) {
    return log(`当前输入无法批量下载：${err.message}`);
  }
  if (!docs.length) return log("没有可下载的单账号 JSON。");
  const items = docs.map((item, i) => {
    const source = importedSourceNames[i] || candidateNameFromEntry(item) || `codex-${i + 1}`;
    return { name: source, value: item };
  });
  const count = downloadJsonZip(items, `rt-refresh-imported-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, "codex");
  log(`已打包 ${count} 个原始单账号 JSON 到 ZIP，并生成备用下载链接。注意：这是旧凭证备份，不是刷新后的凭证。`);
}

async function copyOutput() {
  const text = $("output").value;
  if (!text.trim()) return log("没有导出内容。");
  await navigator.clipboard.writeText(text);
  log("已复制导出 JSON。");
}

async function copyFingerprint() {
  const text = $("fingerprintOutput").value;
  if (!text.trim()) return log("还没有指纹 JSON。");
  await navigator.clipboard.writeText(text);
  log("已复制指纹 JSON。");
}

function downloadFingerprint() {
  const text = $("fingerprintOutput").value.trim();
  if (!text) return log("还没有指纹 JSON。");
  clickDownload(text, `rt-refresh-fingerprint-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

const credentialPaths = {
  access: [["credentials", "access_token"], ["tokens", "access_token"], ["token_data", "access_token"], ["access_token"], ["accessToken"], ["token"]],
  refresh: [["credentials", "refresh_token"], ["tokens", "refresh_token"], ["token_data", "refresh_token"], ["refresh_token"], ["refreshToken"]],
  id: [["credentials", "id_token"], ["tokens", "id_token"], ["token_data", "id_token"], ["id_token"], ["idToken"]],
  expires: [["credentials", "expires_at"], ["tokens", "expires_at"], ["token_data", "expired"], ["expired"], ["expires_at"], ["expiresAt"]],
  lastRefresh: [["last_refresh"], ["lastRefresh"], ["credentials", "last_refresh"], ["tokens", "last_refresh"], ["token_data", "last_refresh"]],
  client: [["credentials", "client_id"], ["client_id"], ["clientId"]],
  scope: [["credentials", "scope"], ["tokens", "scope"], ["scope"]],
  email: [["credentials", "email"], ["email"], ["user", "email"], ["profile", "email"]],
  account: [["credentials", "chatgpt_account_id"], ["chatgpt_account_id"], ["chatgptAccountId"], ["account_id"], ["accountId"], ["token_data", "account_id"], ["account", "id"]],
  user: [["credentials", "chatgpt_user_id"], ["chatgpt_user_id"], ["chatgptUserId"], ["user_id"], ["user", "id"]],
  org: [["credentials", "organization_id"], ["organization_id"], ["organizationId"], ["org_id"], ["orgId"]],
  plan: [["credentials", "plan_type"], ["plan_type"], ["planType"], ["account", "plan_type"], ["account", "planType"]],
  quotaLimit: [["quota_5h_limit"], ["quota5hLimit"], ["usage", "quota_5h_limit"], ["quota", "limit"]],
  quotaUsed: [["quota_5h_used"], ["quota5hUsed"], ["usage", "quota_5h_used"], ["quota", "used"]],
  quotaRemaining: [["quota_5h_remaining"], ["quota5hRemaining"], ["usage", "quota_5h_remaining"], ["quota", "remaining"]],
  quotaReset: [["quota_5h_reset_at"], ["quota5hResetAt"], ["rate_limit_reset_at"], ["rateLimitResetAt"], ["usage", "quota_5h_reset_at"], ["quota", "reset_at"], ["quota", "resetAt"]],
  weeklyLimit: [["quota_weekly_limit"], ["quota_7d_limit"], ["weekly_quota_limit"], ["quotaWeeklyLimit"], ["usage", "quota_weekly_limit"], ["usage", "quota_7d_limit"], ["quota", "weekly_limit"], ["quota", "weeklyLimit"], ["weekly", "limit"]],
  weeklyUsed: [["quota_weekly_used"], ["quota_7d_used"], ["weekly_quota_used"], ["quotaWeeklyUsed"], ["usage", "quota_weekly_used"], ["usage", "quota_7d_used"], ["quota", "weekly_used"], ["quota", "weeklyUsed"], ["weekly", "used"]],
  weeklyRemaining: [["quota_weekly_remaining"], ["quota_7d_remaining"], ["weekly_quota_remaining"], ["quotaWeeklyRemaining"], ["usage", "quota_weekly_remaining"], ["usage", "quota_7d_remaining"], ["quota", "weekly_remaining"], ["quota", "weeklyRemaining"], ["weekly", "remaining"]],
  weeklyReset: [["quota_weekly_reset_at"], ["quota_7d_reset_at"], ["weekly_quota_reset_at"], ["quotaWeeklyResetAt"], ["usage", "quota_weekly_reset_at"], ["usage", "quota_7d_reset_at"], ["quota", "weekly_reset_at"], ["quota", "weeklyResetAt"], ["weekly", "reset_at"], ["weekly", "resetAt"]],
  status: [["status"], ["status_code"], ["statusCode"], ["http_status"], ["httpStatus"], ["error", "status"], ["last_error", "status"]],
  code: [["code"], ["error_code"], ["errorCode"], ["error", "code"], ["last_error", "code"], ["last_error_code"]],
  error: [["error"], ["message"], ["error_message"], ["errorMessage"], ["last_error"], ["lastError"], ["last_error", "message"]],
};

function getByPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function firstAny(obj, paths) {
  for (const path of paths) {
    const v = getByPath(obj, path);
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJWT(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function tokenFingerprint(token) {
  const text = String(token || "");
  if (!text) return "";
  return `${text.slice(0, 10)}…${text.slice(-8)} (${text.length})`;
}

function tokenView(token) {
  return rawCredentialsVisible ? String(token || "") : tokenFingerprint(token);
}

function asDateMs(value) {
  if (value === undefined || value === null || value === "") return NaN;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n < 10_000_000_000 ? n * 1000 : n;
  }
  return Date.parse(text);
}

function isoOrUnknown(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "unknown";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  const sign = ms < 0 ? "-" : "";
  let s = Math.abs(Math.floor(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${sign}${h}h ${m}m ${s}s`;
}

function deriveCredential(entry, index) {
  const access = String(firstAny(entry, credentialPaths.access) || "");
  const refresh = String(firstAny(entry, credentialPaths.refresh) || "");
  const idToken = String(firstAny(entry, credentialPaths.id) || "");
  const claims = parseJWT(idToken) || parseJWT(access) || {};
  const auth = claims["https://api.openai.com/auth"] || {};
  const email = firstAny(entry, credentialPaths.email) || claims.email || "";
  const account = firstAny(entry, credentialPaths.account) || auth.chatgpt_account_id || "";
  const user = firstAny(entry, credentialPaths.user) || auth.chatgpt_user_id || auth.user_id || "";
  const org = firstAny(entry, credentialPaths.org) || auth.poid || (Array.isArray(auth.organizations) && auth.organizations[0]?.id) || "";
  const plan = firstAny(entry, credentialPaths.plan) || auth.chatgpt_plan_type || "";
  const label = candidateNameFromEntry(entry) || email || account || `entry-${index + 1}`;
  const expiresRaw = firstAny(entry, credentialPaths.expires);
  const lastRefreshRaw = firstAny(entry, credentialPaths.lastRefresh);
  const quotaResetRaw = firstAny(entry, credentialPaths.quotaReset);
  const weeklyResetRaw = firstAny(entry, credentialPaths.weeklyReset);
  const expiresAt = asDateMs(expiresRaw);
  const lastRefreshAt = asDateMs(lastRefreshRaw);
  const quotaResetAt = asDateMs(quotaResetRaw);
  const weeklyResetAt = asDateMs(weeklyResetRaw);
  const windowStart = Number.isFinite(lastRefreshAt) ? lastRefreshAt : Date.now();
  const resetAt = Number.isFinite(quotaResetAt) ? quotaResetAt : windowStart + 5 * 60 * 60 * 1000;
  const remaining = finiteNumber(firstAny(entry, credentialPaths.quotaRemaining));
  const limit = finiteNumber(firstAny(entry, credentialPaths.quotaLimit));
  const used = finiteNumber(firstAny(entry, credentialPaths.quotaUsed));
  const weeklyRemaining = finiteNumber(firstAny(entry, credentialPaths.weeklyRemaining));
  const weeklyLimit = finiteNumber(firstAny(entry, credentialPaths.weeklyLimit));
  const weeklyUsed = finiteNumber(firstAny(entry, credentialPaths.weeklyUsed));
  const quotaHasAny = Number.isFinite(quotaResetAt) || limit !== null || used !== null || remaining !== null;
  const weeklyHasAny = Number.isFinite(weeklyResetAt) || weeklyLimit !== null || weeklyUsed !== null || weeklyRemaining !== null;
  return {
    index,
    label,
    source: importedSourceNames[index] || `entry-${index + 1}.json`,
    access,
    refresh,
    idToken,
    email,
    account,
    user,
    org,
    plan,
    expiresAt,
    expiresRaw,
    lastRefreshRaw,
    atRemainingMs: Number.isFinite(expiresAt) ? expiresAt - Date.now() : NaN,
    windowStart,
    resetAt,
    windowRemainingMs: resetAt - Date.now(),
    quota: {
      limit,
      used,
      remaining,
      resetAt: Number.isFinite(quotaResetAt) ? quotaResetAt : null,
      hasAny: quotaHasAny,
      source: quotaHasAny ? "导入字段" : "本地5小时窗口估算",
    },
    weekly: {
      limit: weeklyLimit,
      used: weeklyUsed,
      remaining: weeklyRemaining,
      resetAt: Number.isFinite(weeklyResetAt) ? weeklyResetAt : null,
      hasAny: weeklyHasAny,
      source: weeklyHasAny ? "导入字段" : "未提供",
    },
  };
}

function quotaClass(ms) {
  if (!Number.isFinite(ms)) return "warn";
  if (ms <= 0) return "bad";
  if (ms < 30 * 60 * 1000) return "warn";
  return "ok";
}

function getCredentialItemsFromInput() {
  const input = $("input").value.trim();
  if (!input) return [];
  return flattenClientInput(parseCredentialText(input)).map(deriveCredential);
}

function credentialStats(items) {
  const withRT = items.filter((item) => item.refresh).length;
  const withAT = items.filter((item) => item.access).length;
  const atAlive = items.filter((item) => Number.isFinite(item.atRemainingMs) && item.atRemainingMs > 0).length;
  const quota5hKnown = items.filter((item) => item.quota.hasAny).length;
  const weeklyKnown = items.filter((item) => item.weekly.hasAny).length;
  const weeklyNoQuota = items.filter((item) => item.weekly.remaining !== null && item.weekly.remaining <= 0).length;
  return `
    <div class="overview-stats credential-stats">
      <span>RT ${withRT}/${items.length}</span>
      <span>AT ${withAT}</span>
      <span>AT 未过期 ${atAlive}</span>
      <span>5h 字段 ${quota5hKnown}</span>
      <span>周限额字段 ${weeklyKnown}</span>
      <span>周剩余≤0 ${weeklyNoQuota}</span>
    </div>`;
}

function renderCredentialCard(item) {
  const canRefresh = Boolean(item.refresh);
  return `
    <details class="credential-card">
      <summary>
        <input type="checkbox" class="credential-pick" data-index="${item.index}" ${selected.has(item.index) ? "checked" : ""} ${canRefresh ? "" : "disabled"} />
        <span class="entry-title">
          <b>${escapeHTML(item.label)}</b>
          <small>${escapeHTML(item.email || item.source || "unknown")}</small>
        </span>
        <span class="badge ${canRefresh ? "ok" : "warn"}">${canRefresh ? "RT" : "NO RT"}</span>
        ${item.weekly.hasAny ? `<span class="badge">周限额</span>` : ""}
      </summary>
      <div class="meta">
        <span>source</span><code>${escapeHTML(item.source)}</code>
        <span>email</span><code>${escapeHTML(item.email || "unknown")}</code>
        <span>account</span><code>${escapeHTML(item.account || "unknown")}</code>
        <span>user</span><code>${escapeHTML(item.user || "unknown")}</code>
        <span>org</span><code>${escapeHTML(item.org || "unknown")}</code>
        <span>plan</span><code>${escapeHTML(item.plan || "unknown")}</code>
        <span>AT</span><code>${escapeHTML(tokenView(item.access) || "none")}</code>
        <span>RT</span><code>${escapeHTML(tokenView(item.refresh) || "none")}</code>
        <span>ID</span><code>${escapeHTML(tokenView(item.idToken) || "none")}</code>
        <span>expires</span><code>${escapeHTML(isoOrUnknown(item.expiresAt))}</code>
      </div>
      <div class="quota-row">
        <span class="quota-pill ${quotaClass(item.atRemainingMs)}">AT 剩余 ${escapeHTML(formatDuration(item.atRemainingMs))}</span>
        <span class="quota-pill ${quotaClass(item.windowRemainingMs)}">5h reset ${escapeHTML(formatDuration(item.windowRemainingMs))}</span>
        <span class="quota-pill">窗口源：${escapeHTML(item.quota.source)}</span>
        ${item.quota.remaining != null ? `<span class="quota-pill ok">remaining ${escapeHTML(item.quota.remaining)}</span>` : ""}
        ${item.quota.limit != null ? `<span class="quota-pill">limit ${escapeHTML(item.quota.limit)}</span>` : ""}
        ${item.quota.used != null ? `<span class="quota-pill warn">used ${escapeHTML(item.quota.used)}</span>` : ""}
      </div>
      <div class="quota-row weekly-row">
        <span class="quota-pill">周限额源：${escapeHTML(item.weekly.source)}</span>
        ${item.weekly.resetAt != null ? `<span class="quota-pill ${quotaClass(item.weekly.resetAt - Date.now())}">week reset ${escapeHTML(formatDuration(item.weekly.resetAt - Date.now()))}</span>` : ""}
        ${item.weekly.remaining != null ? `<span class="quota-pill ${item.weekly.remaining > 0 ? "ok" : "bad"}">week remaining ${escapeHTML(item.weekly.remaining)}</span>` : ""}
        ${item.weekly.limit != null ? `<span class="quota-pill">week limit ${escapeHTML(item.weekly.limit)}</span>` : ""}
        ${item.weekly.used != null ? `<span class="quota-pill warn">week used ${escapeHTML(item.weekly.used)}</span>` : ""}
      </div>
    </details>`;
}

function renderCredentialPage() {
  const target = $("credentialDetails");
  if (!lastCredentialItems.length) {
    target.innerHTML = `<div class="hint">还没导入凭证。宝宝，空页面不会自己长账号出来。</div>`;
    return;
  }
  const page = currentPageItems(lastCredentialItems, credentialPage);
  credentialPage = page.page;
  target.innerHTML = `
    ${credentialStats(lastCredentialItems)}
    ${renderPager("credential", lastCredentialItems.length, credentialPage, { selectable: true })}
    <div class="credential-grid">${page.items.map(renderCredentialCard).join("")}</div>
    ${renderPager("credential", lastCredentialItems.length, credentialPage, { selectable: true })}`;
  target.querySelectorAll(".credential-pick").forEach((box) => {
    box.addEventListener("click", (ev) => ev.stopPropagation());
    box.addEventListener("change", () => {
      const idx = Number(box.dataset.index);
      if (box.checked) selected.add(idx); else selected.delete(idx);
      syncSelectionControls();
    });
  });
  target.querySelectorAll("[data-credential-action]").forEach((button) => {
    button.addEventListener("click", () => handleCredentialAction(button.dataset.credentialAction, target));
  });
}

function handleCredentialAction(action, target) {
  const page = currentPageItems(lastCredentialItems, credentialPage);
  if (action === "first") credentialPage = 1;
  if (action === "prev") credentialPage = Math.max(1, credentialPage - 1);
  if (action === "next") credentialPage = Math.min(page.totalPages, credentialPage + 1);
  if (action === "last") credentialPage = page.totalPages;
  if (action === "select-page") return selectItems(page.items, "select");
  if (action === "select-all") return selectItems(lastCredentialItems, "select");
  if (action === "select-none") return selectItems(lastCredentialItems, "none");
  if (action === "invert-page") return selectItems(page.items, "invert");
  if (action === "expand-page") return setDetailsOpen(target, true);
  if (action === "collapse-page") return setDetailsOpen(target, false);
  renderCredentialPage();
}

function renderCredentialDetails(shouldLog = true) {
  const target = $("credentialDetails");
  try {
    lastCredentialItems = getCredentialItemsFromInput();
  } catch (err) {
    lastCredentialItems = [];
    target.innerHTML = `<div class="hint">解析失败：${escapeHTML(err.message)}</div>`;
    if (shouldLog) log(`凭证明细解析失败：${err.message}`);
    return;
  }
  credentialPage = 1;
  renderCredentialPage();
  if (shouldLog) {
    if (!lastCredentialItems.length) log("没有导入内容，无法显示凭证明细。");
    else log(`已显示 ${lastCredentialItems.length} 条导入凭证；每页 ${PAGE_SIZE} 条，可展开/折叠，5 小时与周限额字段都会保留显示。`);
  }
}

function toggleRawCredentials() {
  rawCredentialsVisible = !rawCredentialsVisible;
  $("toggleRawCredentials").textContent = rawCredentialsVisible ? "隐藏原文凭证" : "显示原文凭证";
  renderCredentialDetails(false);
  log(rawCredentialsVisible ? "已显示原文凭证。CTF 模式也别把截图乱发，笨蛋。" : "已隐藏原文凭证，改回摘要显示。");
}

async function startOAuthLogin() {
  const scope = "openid email profile offline_access";
  const resp = await fetch(`/api/oauth/start?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  lastOAuthStart = data;
  $("oauthOutput").value = pretty(data);
  log(`已生成 Codex 登录链接，回调地址：${data.redirect_uri}`);
}

function openOAuthLogin() {
  const url = lastOAuthStart?.authorize_url;
  if (!url) return log("还没生成登录链接。先点“生成登录链接”。");
  window.open(url, "_blank", "noopener,noreferrer");
  log("已打开 Codex 登录页。完成后回到这里点“刷新登录结果”。");
}

async function refreshOAuthLogins() {
  const data = await fetch("/api/oauth/latest", { cache: "no-store" }).then((r) => r.json());
  $("oauthOutput").value = pretty(data);
  log(`已刷新在线登录结果：${data.count || 0} 条。`);
}

function downloadOAuthLatest() {
  window.location.href = "/api/oauth/download/latest";
  log("已请求下载最新 OAuth 登录 CPA JSON；如果 404，说明还没有登录成功结果。");
}

function remoteCPAConnectionPayload() {
  const searchOrIds = $("remoteCpaSearch").value.trim();
  const filters = {
    platform: $("remoteCpaPlatform").value.trim() || "openai",
    type: $("remoteCpaType").value.trim() || "oauth",
    status: $("remoteCpaStatus").value.trim() || "active",
    include_proxies: false,
  };
  if (/^\d+(?:\s*,\s*\d+)*$/.test(searchOrIds)) filters.ids = searchOrIds;
  else if (searchOrIds) filters.search = searchOrIds;
  return {
    base_url: $("remoteCpaUrl").value.trim(),
    admin_key: $("remoteCpaKey").value,
    auth_mode: $("remoteCpaAuthMode").value,
    filters,
  };
}

async function remoteCPAPull() {
  const payload = remoteCPAConnectionPayload();
  if (!payload.base_url || !payload.admin_key) return log("CPA 地址和 CPA 密码/API Key 都要填。");
  const data = await api("/api/remote-cpa/pull", payload);
  $("input").value = pretty(data.data);
  $("remoteCpaOutput").value = pretty({
    ok: true,
    action: "pull",
    count: data.count,
    note: "已拉取远程 CPA accounts/data 并导入当前输入框；尚未刷新，也没有回导。",
  });
  log(`远程 CPA 拉取完成：${data.count} 条，已导入输入框。`);
  await analyze();
}

async function remoteCPAClean() {
  const payload = {
    ...remoteCPAConnectionPayload(),
    write_back: $("remoteCpaWriteBack").checked,
    require_refresh_token: $("remoteCpaRequireRT").checked,
    skip_default_group_bind: $("remoteCpaSkipDefaultGroup").checked,
    refresh_options: {
      token_url: $("tokenUrl").value.trim(),
      client_id: $("clientId").value.trim(),
      scope: $("scope").value.trim(),
      user_agent: $("ua").value.trim(),
      request_interval_ms: Number($("requestInterval").value || 0),
      retry_attempts: Number($("retryAttempts").value || 1),
      retry_backoff_ms: Number($("retryBackoff").value || 1000),
    },
  };
  if (!payload.base_url || !payload.admin_key) return log("CPA 地址和 CPA 密码/API Key 都要填。");
  if (payload.write_back && !confirm("确认把清洗后的可用凭证回导到远程 CPA？这是一次性写入。")) {
    return log("已取消回导。");
  }
  $("remoteCpaClean").disabled = true;
  $("remoteCpaClean").textContent = "清洗中...";
  try {
    const result = await api("/api/remote-cpa/clean", payload);
    lastRemoteCPAResult = result;
    $("remoteCpaOutput").value = pretty({
      ok: result.ok,
      write_back: result.write_back,
      pulled: result.pulled,
      kept: result.kept,
      dropped: result.dropped,
      refreshed: result.refreshed,
      failed: result.failed,
      invalid_log: result.invalid_log,
      import_result: result.import_result,
    });
    $("output").value = pretty(result.cleaned);
    if (result.cleaned) $("input").value = pretty(result.cleaned);
    log(`远程 CPA 一次性清洗完成：拉取 ${result.pulled}，保留 ${result.kept}，剔除 ${result.dropped}，刷新成功 ${result.refreshed}，失败 ${result.failed}，write_back=${result.write_back}。`);
    if (result.dropped) log(`无效凭证日志已生成：${result.dropped} 条，可点“下载无效日志”。`);
    await analyze().catch(() => {});
  } finally {
    $("remoteCpaClean").disabled = false;
    $("remoteCpaClean").textContent = "一次性刷新清洗";
  }
}

function downloadRemoteInvalidLog() {
  const rows = lastRemoteCPAResult?.invalid_log || [];
  if (!rows.length) return log("还没有无效凭证日志。先跑一次远程 CPA 清洗。");
  clickDownload(pretty({
    generated_at: new Date().toISOString(),
    count: rows.length,
    invalid_log: rows,
  }), `rt-refresh-remote-cpa-invalid-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function explicitQuotaState(entry) {
  const remainingRaw = firstAny(entry, credentialPaths.quotaRemaining);
  const limitRaw = firstAny(entry, credentialPaths.quotaLimit);
  const usedRaw = firstAny(entry, credentialPaths.quotaUsed);
  const remaining = finiteNumber(remainingRaw);
  const limit = finiteNumber(limitRaw);
  const used = finiteNumber(usedRaw);
  if (remaining !== null) return { known: true, hasQuota: remaining > 0, reason: `quota_remaining=${remaining}` };
  if (limit !== null && used !== null) return { known: true, hasQuota: used < limit, reason: `quota_used=${used}/${limit}` };
  return { known: false, hasQuota: true, reason: "quota_unknown_allowed" };
}

function classifyNormalCredential(entry, result = null) {
  const statusRaw = result?.status || firstAny(entry, credentialPaths.status);
  const status = Number(statusRaw || 0);
  const code = String(result?.code || firstAny(entry, credentialPaths.code) || "").toLowerCase();
  const errorText = String(result?.error || firstAny(entry, credentialPaths.error) || "").toLowerCase();
  const access = firstAny(entry, credentialPaths.access);
  const refresh = firstAny(entry, credentialPaths.refresh);
  const expiresAt = asDateMs(firstAny(entry, credentialPaths.expires));
  const quota = explicitQuotaState(entry);

  if (result?.ok) return { normal: true, reason: "refreshed_ok" };
  if (status === 429 || code.includes("rate_limited") || errorText.includes("429")) {
    return { normal: true, reason: "rate_limited_429_not_abnormal" };
  }
  if (status === 401 || status === 402) return { normal: false, reason: `http_${status}` };
  if (/app_session_terminated|refresh_token_reused|invalid_grant|invalid_client|unauthorized|payment_required|billing|insufficient_quota|quota_exceeded|no[_ -]?quota|session has ended|signing in|sign in|log in|login|relogin|re-login/.test(`${code} ${errorText}`)) {
    return { normal: false, reason: code || "needs_relogin_or_no_quota" };
  }
  if (quota.known && !quota.hasQuota) return { normal: false, reason: quota.reason };
  if (!access && !refresh) return { normal: false, reason: "missing_access_and_refresh_token" };
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now() && !refresh) return { normal: false, reason: "expired_without_refresh_token" };
  return { normal: true, reason: quota.reason };
}

function currentImportedDocs() {
  const input = $("input").value.trim();
  if (!input) return [];
  return flattenClientInput(parseCredentialText(input));
}

function addIfValue(out, key, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") out[key] = value;
}

function canonicalMetadataFromEntry(entry) {
  const out = {};
  const fieldMap = {
    quota_5h_limit: credentialPaths.quotaLimit,
    quota_5h_used: credentialPaths.quotaUsed,
    quota_5h_remaining: credentialPaths.quotaRemaining,
    quota_5h_reset_at: credentialPaths.quotaReset,
    quota_weekly_limit: credentialPaths.weeklyLimit,
    quota_weekly_used: credentialPaths.weeklyUsed,
    quota_weekly_remaining: credentialPaths.weeklyRemaining,
    quota_weekly_reset_at: credentialPaths.weeklyReset,
  };
  for (const [key, paths] of Object.entries(fieldMap)) addIfValue(out, key, firstAny(entry, paths));
  return out;
}

function toCliProxyCredential(entry, index = 0) {
  const item = deriveCredential(entry, index);
  const out = {
    type: "codex",
    ...canonicalMetadataFromEntry(entry),
  };
  addIfValue(out, "access_token", item.access);
  addIfValue(out, "refresh_token", item.refresh);
  addIfValue(out, "id_token", item.idToken);
  addIfValue(out, "account_id", item.account);
  addIfValue(out, "email", item.email);
  addIfValue(out, "chatgpt_user_id", item.user);
  addIfValue(out, "organization_id", item.org);
  addIfValue(out, "plan_type", item.plan);
  addIfValue(out, "last_refresh", item.lastRefreshRaw);
  addIfValue(out, "expired", item.expiresRaw || (Number.isFinite(item.expiresAt) ? new Date(item.expiresAt).toISOString() : ""));
  addIfValue(out, "client_id", firstAny(entry, credentialPaths.client) || $("clientId").value.trim());
  addIfValue(out, "scope", firstAny(entry, credentialPaths.scope) || $("scope").value.trim());
  return out;
}

function refreshedCanonicalByIndex() {
  const out = new Map();
  if (!lastRefreshResult?.canonical?.length) return out;
  const okResults = lastRefreshResult.results.filter((r) => r.ok);
  lastRefreshResult.canonical.forEach((item, i) => {
    const result = okResults[i];
    if (result) out.set(result.index, item);
  });
  return out;
}

function convertedCpaJsonFromCurrentInput() {
  const docs = currentImportedDocs();
  const refreshed = refreshedCanonicalByIndex();
  return docs.map((doc, i) => {
    const refreshedItem = refreshed.get(i);
    return refreshedItem ? { ...canonicalMetadataFromEntry(doc), ...refreshedItem } : toCliProxyCredential(doc, i);
  });
}

function exportConvertedCpaJson() {
  let items;
  try {
    items = convertedCpaJsonFromCurrentInput();
  } catch (err) {
    return log(`当前输入无法转换成 CPA JSON：${err.message}`);
  }
  if (!items.length) return log("没有导入内容，无法导出 CPA JSON。");
  const text = pretty(items);
  $("output").value = text;
  clickDownload(text, `rt-refresh-sub2api-to-cpa-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const refreshedCount = refreshedCanonicalByIndex().size;
  log(`已导出 ${items.length} 条 Sub2API→CPA/Codex auth JSON；刷新成功项优先使用新 token：${refreshedCount} 条，其余已转换保留。`);
}

function downloadNormalCredentials() {
  let docs;
  try {
    docs = currentImportedDocs();
  } catch (err) {
    return log(`当前输入无法筛选正常凭证：${err.message}`);
  }
  if (!docs.length) return log("没有导入内容，无法筛选正常凭证。");

  const okByIndex = refreshedCanonicalByIndex();

  const items = [];
  const rejected = [];
  const resultByIndex = new Map((lastRefreshResult?.results || []).map((r) => [r.index, r]));
  docs.forEach((doc, i) => {
    const refreshed = okByIndex.get(i);
    const value = refreshed ? { ...canonicalMetadataFromEntry(doc), ...refreshed } : toCliProxyCredential(doc, i);
    const result = resultByIndex.get(i) || null;
    const cls = classifyNormalCredential(value, result);
    const source = importedSourceNames[i] || candidateNameFromEntry(value) || candidateNameFromEntry(doc) || `codex-${i + 1}`;
    if (cls.normal) items.push({ name: source, value });
    else rejected.push({ index: i, source, reason: cls.reason });
  });

  if (!items.length) {
    const sample = rejected.slice(0, 8).map((x) => `#${x.index} ${x.reason}`).join("; ");
    return log(`筛选后没有正常凭证。排除 ${rejected.length} 条：${sample}`);
  }
  const count = downloadJsonZip(items, `rt-refresh-normal-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, "codex-normal");
  const rateLimitedKept = (lastRefreshResult?.results || []).filter((r) => Number(r.status) === 429).length;
  log(`已打包 ${count} 个正常 CLIProxyAPI/Codex auth 凭证到 ZIP；排除 ${rejected.length} 条异常。规则：401/402/需要重登/明确无额度会排除；429 只算限速，不当异常${rateLimitedKept ? `（本轮保留 429：${rateLimitedKept} 条）` : ""}。`);
}

$("file").addEventListener("change", async (ev) => {
  if (!ev.target.files?.length) return;
  await importFiles(ev.target.files);
  ev.target.value = "";
});

const dropzone = $("dropzone");
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (ev) => { ev.preventDefault(); dropzone.classList.add("dragover"); });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (ev) => { ev.preventDefault(); dropzone.classList.remove("dragover"); });
}
dropzone.addEventListener("drop", (ev) => importFiles(ev.dataTransfer.files).catch((e) => log(e.message)));
$("analyze").addEventListener("click", () => analyze().catch((e) => log(e.message)));
$("refresh").addEventListener("click", () => refresh().catch((e) => log(e.message)));
$("sample").addEventListener("click", sample);
$("clear").addEventListener("click", () => { $("input").value = ""; $("output").value = ""; $("entries").innerHTML = ""; $("credentialDetails").innerHTML = ""; currentEntries = []; selected.clear(); importedSourceNames = []; lastCredentialItems = []; entryPage = 1; credentialPage = 1; lastRefreshResult = null; updateSummary(); log("已清空。"); });
$("selectAll").addEventListener("click", () => {
  selectItems(currentEntries, "select");
});
$("selectNone").addEventListener("click", () => {
  selectItems(currentEntries, "none");
});
$("invertSelection").addEventListener("click", () => {
  selectItems(currentEntries, "invert");
});
$("download").addEventListener("click", download);
$("exportConvertedCpaJson").addEventListener("click", exportConvertedCpaJson);
$("exportCpaCredentials").addEventListener("click", downloadNormalCredentials);
$("downloadEachRefreshed").addEventListener("click", downloadEachRefreshed);
$("downloadNormalCredentials").addEventListener("click", downloadNormalCredentials);
$("downloadEachImported").addEventListener("click", downloadEachImported);
$("copy").addEventListener("click", () => copyOutput().catch((e) => log(e.message)));
$("collectFingerprint").addEventListener("click", () => collectFingerprint().catch((e) => log(e.message)));
$("copyFingerprint").addEventListener("click", () => copyFingerprint().catch((e) => log(e.message)));
$("downloadFingerprint").addEventListener("click", downloadFingerprint);
$("refreshCaptures").addEventListener("click", () => refreshCaptures().catch((e) => log(e.message)));
$("clearCaptures").addEventListener("click", () => clearCaptures().catch((e) => log(e.message)));
$("downloadCaptures").addEventListener("click", downloadCaptures);
$("startOAuthLogin").addEventListener("click", () => startOAuthLogin().catch((e) => log(e.message)));
$("openOAuthLogin").addEventListener("click", openOAuthLogin);
$("refreshOAuthLogins").addEventListener("click", () => refreshOAuthLogins().catch((e) => log(e.message)));
$("downloadOAuthLatest").addEventListener("click", downloadOAuthLatest);
$("remoteCpaPull").addEventListener("click", () => remoteCPAPull().catch((e) => log(e.message)));
$("remoteCpaClean").addEventListener("click", () => remoteCPAClean().catch((e) => log(e.message)));
$("downloadRemoteInvalidLog").addEventListener("click", downloadRemoteInvalidLog);
$("renderCredentialDetails").addEventListener("click", () => renderCredentialDetails(true));
$("toggleRawCredentials").addEventListener("click", toggleRawCredentials);

loadConfig().catch((e) => log(e.message));
