const $ = (id) => document.getElementById(id);

let currentEntries = [];
let selected = new Set();
let importedSourceNames = [];
let lastRefreshResult = null;
let lastDownloadObjectUrl = "";
let lastOAuthStart = null;
let rawCredentialsVisible = false;

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
    const items = lastRefreshResult.canonical.map((item, i) => {
      const result = okResults[i] || {};
      const source = importedSourceNames[result.index] || result.label || candidateNameFromEntry(item) || `codex-${i + 1}`;
      return { name: source, value: item };
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
  email: [["credentials", "email"], ["email"], ["user", "email"], ["profile", "email"]],
  account: [["credentials", "chatgpt_account_id"], ["chatgpt_account_id"], ["chatgptAccountId"], ["account_id"], ["accountId"], ["token_data", "account_id"], ["account", "id"]],
  user: [["credentials", "chatgpt_user_id"], ["chatgpt_user_id"], ["chatgptUserId"], ["user_id"], ["user", "id"]],
  org: [["credentials", "organization_id"], ["organization_id"], ["organizationId"], ["org_id"], ["orgId"]],
  plan: [["credentials", "plan_type"], ["plan_type"], ["planType"], ["account", "plan_type"], ["account", "planType"]],
  quotaLimit: [["quota_5h_limit"], ["quota5hLimit"], ["usage", "quota_5h_limit"], ["quota", "limit"]],
  quotaUsed: [["quota_5h_used"], ["quota5hUsed"], ["usage", "quota_5h_used"], ["quota", "used"]],
  quotaRemaining: [["quota_5h_remaining"], ["quota5hRemaining"], ["usage", "quota_5h_remaining"], ["quota", "remaining"]],
  quotaReset: [["quota_5h_reset_at"], ["quota5hResetAt"], ["rate_limit_reset_at"], ["rateLimitResetAt"], ["usage", "quota_5h_reset_at"], ["quota", "reset_at"], ["quota", "resetAt"]],
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
  const expiresAt = asDateMs(firstAny(entry, credentialPaths.expires));
  const lastRefreshAt = asDateMs(firstAny(entry, credentialPaths.lastRefresh));
  const quotaResetAt = asDateMs(firstAny(entry, credentialPaths.quotaReset));
  const windowStart = Number.isFinite(lastRefreshAt) ? lastRefreshAt : Date.now();
  const resetAt = Number.isFinite(quotaResetAt) ? quotaResetAt : windowStart + 5 * 60 * 60 * 1000;
  const remaining = Number(firstAny(entry, credentialPaths.quotaRemaining));
  const limit = Number(firstAny(entry, credentialPaths.quotaLimit));
  const used = Number(firstAny(entry, credentialPaths.quotaUsed));
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
    atRemainingMs: Number.isFinite(expiresAt) ? expiresAt - Date.now() : NaN,
    windowStart,
    resetAt,
    windowRemainingMs: resetAt - Date.now(),
    quota: {
      limit: Number.isFinite(limit) ? limit : null,
      used: Number.isFinite(used) ? used : null,
      remaining: Number.isFinite(remaining) ? remaining : null,
      source: Number.isFinite(quotaResetAt) || Number.isFinite(limit) || Number.isFinite(used) || Number.isFinite(remaining) ? "导入字段" : "本地5小时窗口估算",
    },
  };
}

function quotaClass(ms) {
  if (!Number.isFinite(ms)) return "warn";
  if (ms <= 0) return "bad";
  if (ms < 30 * 60 * 1000) return "warn";
  return "ok";
}

function renderCredentialDetails(shouldLog = true) {
  const input = $("input").value.trim();
  const target = $("credentialDetails");
  if (!input) {
    target.innerHTML = `<div class="hint">还没导入凭证。宝宝，空页面不会自己长账号出来。</div>`;
    if (shouldLog) log("没有导入内容，无法显示凭证明细。");
    return;
  }
  let docs;
  try {
    docs = flattenClientInput(parseCredentialText(input));
  } catch (err) {
    target.innerHTML = `<div class="hint">解析失败：${escapeHTML(err.message)}</div>`;
    if (shouldLog) log(`凭证明细解析失败：${err.message}`);
    return;
  }
  const items = docs.map(deriveCredential);
  target.innerHTML = items.map((item) => `
    <article class="credential-card">
      <header>
        <h3>${escapeHTML(item.label)}</h3>
        <span class="badge ${item.refresh ? "ok" : "warn"}">${item.refresh ? "RT" : "NO RT"}</span>
      </header>
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
    </article>
  `).join("");
  if (shouldLog) log(`已显示 ${items.length} 条导入凭证；5 小时额度优先读导入字段，没有字段则本地估算窗口。`);
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

function explicitQuotaState(entry) {
  const remainingRaw = firstAny(entry, credentialPaths.quotaRemaining);
  const limitRaw = firstAny(entry, credentialPaths.quotaLimit);
  const usedRaw = firstAny(entry, credentialPaths.quotaUsed);
  const remaining = remainingRaw === "" ? NaN : Number(remainingRaw);
  const limit = limitRaw === "" ? NaN : Number(limitRaw);
  const used = usedRaw === "" ? NaN : Number(usedRaw);
  if (Number.isFinite(remaining)) return { known: true, hasQuota: remaining > 0, reason: `quota_remaining=${remaining}` };
  if (Number.isFinite(limit) && Number.isFinite(used)) return { known: true, hasQuota: used < limit, reason: `quota_used=${used}/${limit}` };
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

function downloadNormalCredentials() {
  let docs;
  try {
    docs = currentImportedDocs();
  } catch (err) {
    return log(`当前输入无法筛选正常凭证：${err.message}`);
  }
  if (!docs.length) return log("没有导入内容，无法筛选正常凭证。");

  const okByIndex = new Map();
  if (lastRefreshResult?.canonical?.length) {
    const okResults = lastRefreshResult.results.filter((r) => r.ok);
    lastRefreshResult.canonical.forEach((item, i) => {
      const result = okResults[i];
      if (result) okByIndex.set(result.index, { value: item, result });
    });
  }

  const items = [];
  const rejected = [];
  const resultByIndex = new Map((lastRefreshResult?.results || []).map((r) => [r.index, r]));
  docs.forEach((doc, i) => {
    const refreshed = okByIndex.get(i);
    const value = refreshed?.value || doc;
    const result = refreshed?.result || resultByIndex.get(i) || null;
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
  log(`已打包 ${count} 个正常凭证到 ZIP；排除 ${rejected.length} 条异常。规则：401/402/需要重登/明确无额度会排除；429 只算限速，不当异常${rateLimitedKept ? `（本轮保留 429：${rateLimitedKept} 条）` : ""}。`);
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
$("clear").addEventListener("click", () => { $("input").value = ""; $("output").value = ""; $("entries").innerHTML = ""; $("credentialDetails").innerHTML = ""; currentEntries = []; selected.clear(); importedSourceNames = []; lastRefreshResult = null; updateSummary(); log("已清空。"); });
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
$("renderCredentialDetails").addEventListener("click", () => renderCredentialDetails(true));
$("toggleRawCredentials").addEventListener("click", toggleRawCredentials);

loadConfig().catch((e) => log(e.message));
