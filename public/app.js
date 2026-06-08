const $ = (id) => document.getElementById(id);

let currentEntries = [];
let selected = new Set();
let importedSourceNames = [];
let lastRefreshResult = null;

function updateSummary() {
  const refreshable = currentEntries.filter((e) => e.has_refresh_token).length;
  $("summary").textContent = `共 ${currentEntries.length} 条，${refreshable} 条可刷新，当前选中 ${selected.size} 条。`;
}

function log(line) {
  $("log").textContent = `[${new Date().toLocaleTimeString()}] ${line}\n` + $("log").textContent;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
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

function clickDownload(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  clickDownloadBlob(blob, filename);
}

function clickDownloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  if (cfg.capture_redact === false) log("CTF 原文捕获模式已开启：服务端不会脱敏捕获字段。");
}

function renderEntries(entries) {
  currentEntries = entries;
  selected = new Set(entries.filter((e) => e.has_refresh_token).map((e) => e.index));
  updateSummary();
  $("entries").innerHTML = entries.map((e) => `
    <label class="entry">
      <input type="checkbox" class="pick" data-index="${e.index}" ${selected.has(e.index) ? "checked" : ""} ${e.has_refresh_token ? "" : "disabled"} />
      <b>${escapeHTML(e.label)}</b>
      <small>AT# ${e.access_fingerprint || "none"}</small>
      <small>RT# ${e.refresh_fingerprint || "none"}</small>
      <small>src ${escapeHTML(importedSourceNames[e.index] || `#${e.index + 1}`)}</small>
      <small>exp ${escapeHTML(e.expires_at || "unknown")}</small>
      <span class="badge ${e.has_refresh_token ? "ok" : "warn"}">${e.has_refresh_token ? "RT OK" : "NO RT"}</span>
      ${e.plan_type ? `<span class="badge">${escapeHTML(e.plan_type)}</span>` : ""}
    </label>`).join("");
  document.querySelectorAll(".pick").forEach((box) => {
    box.addEventListener("change", () => {
      const idx = Number(box.dataset.index);
      if (box.checked) selected.add(idx); else selected.delete(idx);
      updateSummary();
    });
  });
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
      importedSourceNames.push(parsed.length === 1 ? file.name : `${file.name}#${i + 1}`);
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
    const items = lastRefreshResult.canonical.map((item, i) => {
      const result = okResults[i] || {};
      const source = importedSourceNames[result.index] || item.email || item.account_id || `codex-${i + 1}`;
      return { name: source, value: item };
    });
    downloadJsonZip(items, `rt-refresh-refreshed-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, "codex");
    log(`已打包 ${lastRefreshResult.canonical.length} 个刷新后单账号 JSON 到 ZIP。`);
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
    const source = importedSourceNames[i] || item?.email || item?.account_id || item?.credentials?.email || `codex-${i + 1}`;
    return { name: source, value: item };
  });
  downloadJsonZip(items, `rt-refresh-imported-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, "codex");
  log(`已打包 ${docs.length} 个原始单账号 JSON 到 ZIP。注意：这是旧凭证备份，不是刷新后的凭证。`);
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
$("clear").addEventListener("click", () => { $("input").value = ""; $("output").value = ""; $("entries").innerHTML = ""; currentEntries = []; selected.clear(); importedSourceNames = []; lastRefreshResult = null; updateSummary(); log("已清空。"); });
$("selectAll").addEventListener("click", () => {
  document.querySelectorAll(".pick:not(:disabled)").forEach((box) => { box.checked = true; selected.add(Number(box.dataset.index)); });
  updateSummary();
});
$("selectNone").addEventListener("click", () => {
  document.querySelectorAll(".pick").forEach((box) => { box.checked = false; });
  selected.clear();
  updateSummary();
});
$("invertSelection").addEventListener("click", () => {
  document.querySelectorAll(".pick:not(:disabled)").forEach((box) => {
    const idx = Number(box.dataset.index);
    box.checked = !box.checked;
    if (box.checked) selected.add(idx); else selected.delete(idx);
  });
  updateSummary();
});
$("download").addEventListener("click", download);
$("downloadEachRefreshed").addEventListener("click", downloadEachRefreshed);
$("downloadEachImported").addEventListener("click", downloadEachImported);
$("copy").addEventListener("click", () => copyOutput().catch((e) => log(e.message)));
$("collectFingerprint").addEventListener("click", () => collectFingerprint().catch((e) => log(e.message)));
$("copyFingerprint").addEventListener("click", () => copyFingerprint().catch((e) => log(e.message)));
$("downloadFingerprint").addEventListener("click", downloadFingerprint);
$("refreshCaptures").addEventListener("click", () => refreshCaptures().catch((e) => log(e.message)));
$("clearCaptures").addEventListener("click", () => clearCaptures().catch((e) => log(e.message)));
$("downloadCaptures").addEventListener("click", downloadCaptures);

loadConfig().catch((e) => log(e.message));
