import http from "node:http";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeInput, refreshCPA, flattenInput, normalizeEntry, toCanonicalCPA, OPENAI_CODEX_CLIENT_ID, OPENAI_TOKEN_URL, OPENAI_REFRESH_SCOPE } from "./cpa.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const captureLimit = Number(process.env.CAPTURE_LIMIT || 500);
const proxyTargetBase = process.env.PROXY_TARGET_BASE || "";
const authUser = process.env.AUTH_USER || process.env.RT_REFRESH_USER || "admin";
const authPassword = process.env.AUTH_PASSWORD || process.env.RT_REFRESH_PASSWORD || "";
const authRealm = process.env.AUTH_REALM || "rt-refresh";
const captureRedact = !["0", "false", "no", "off", "raw"].includes(String(process.env.CAPTURE_REDACT ?? "true").toLowerCase());
const oauthAuthURL = process.env.OAUTH_AUTH_URL || "https://auth.openai.com/oauth/authorize";
const oauthTokenURL = process.env.OAUTH_TOKEN_URL || OPENAI_TOKEN_URL;
const oauthSessions = new Map();
const oauthLogins = [];
const captures = [];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendHTML(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function sendDownloadJSON(res, filename, data) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
  });
  res.end(JSON.stringify(data, null, 2));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timingSafeTextEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function parseBasicAuth(header) {
  if (!header || !String(header).startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(String(header).slice(6), "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split < 0) return null;
    return { user: decoded.slice(0, split), password: decoded.slice(split + 1) };
  } catch {
    return null;
  }
}

function checkAuth(req) {
  if (!authPassword) return true;
  const basic = parseBasicAuth(req.headers.authorization);
  if (!basic) return false;
  return timingSafeTextEqual(basic.user, authUser) && timingSafeTextEqual(basic.password, authPassword);
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": `Basic realm="${authRealm.replace(/"/g, "")}"`,
  });
  res.end(JSON.stringify({ error: "auth_required", message: "用户名或密码不正确" }));
}

function baseURLFromRequest(req) {
  const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  return `${String(proto).split(",")[0]}://${String(hostHeader).split(",")[0]}`;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomURLToken(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

function pkceChallenge(verifier) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

function cleanupOAuthSessions() {
  const now = Date.now();
  for (const [state, session] of oauthSessions.entries()) {
    if (!session || session.expires_at_ms < now) oauthSessions.delete(state);
  }
}

function oauthRedirectURI(req, url) {
  return url.searchParams.get("redirect_uri") || process.env.OAUTH_REDIRECT_URI || `${baseURLFromRequest(req)}/oauth/callback`;
}

function buildCodexAuthorizeURL({ state, verifier, redirect_uri, scope }) {
  const params = new URLSearchParams({
    client_id: OPENAI_CODEX_CLIENT_ID,
    response_type: "code",
    redirect_uri,
    scope,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "login",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });
  return `${oauthAuthURL}?${params.toString()}`;
}

async function exchangeCodexCode({ code, code_verifier, redirect_uri, client_id = OPENAI_CODEX_CLIENT_ID }) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id,
    code,
    redirect_uri,
    code_verifier,
  });
  const resp = await fetch(oauthTokenURL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "accept": "application/json",
      "user-agent": "codex-cli/0.91.0",
    },
    body: form,
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!resp.ok) {
    const err = new Error(`token exchange failed: ${resp.status} ${typeof data === "object" ? JSON.stringify(data) : text}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  const entry = normalizeEntry({
    type: "codex",
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
    client_id,
  });
  const canonical = toCanonicalCPA(entry, data);
  canonical.oauth_login = {
    provider: "openai_codex",
    redirect_uri,
    token_url: oauthTokenURL,
    created_at: new Date().toISOString(),
  };
  return { token_response: data, canonical };
}

function storeOAuthLogin({ canonical, token_response, redirect_uri }) {
  const item = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    created_at: new Date().toISOString(),
    provider: "openai_codex",
    redirect_uri,
    label: canonical.email || canonical.account_id || "codex-oauth",
    canonical,
    token_response,
  };
  oauthLogins.unshift(item);
  if (oauthLogins.length > 50) oauthLogins.length = 50;
  return item;
}

function oauthCallbackHTML(item) {
  const json = escapeHTML(JSON.stringify(item.canonical, null, 2));
  return `<!doctype html><meta charset="utf-8" /><title>Codex OAuth 登录完成</title>
<style>body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#09111f;color:#e5eefb;margin:0;padding:28px}main{max-width:980px;margin:auto}a,button{color:#7dd3fc}pre{white-space:pre-wrap;background:#0f1b2d;border:1px solid #233047;border-radius:14px;padding:18px;overflow:auto}.ok{color:#86efac}</style>
<main>
<h1 class="ok">Codex OAuth 登录成功</h1>
<p>凭证已保存在当前服务内存里。回到 rt-refresh 页面点“刷新登录结果”，或直接下载。</p>
<p><a download="codex-oauth-${item.id}.json" href="/api/oauth/download/${item.id}">下载 CPA JSON</a> · <a href="/">返回管理台</a></p>
<pre>${json}</pre>
</main>`;
}

function normalizeBaseURL(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) throw new Error("缺少 CPA Base URL");
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("CPA Base URL 只支持 http/https");
  return url.toString().replace(/\/+$/, "");
}

function encodeQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    q.set(key, String(value));
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}

function remoteCPAHeaders({ admin_key, auth_mode = "x-api-key" } = {}) {
  const key = String(admin_key || "").trim();
  if (!key) throw new Error("缺少 CPA 密码 / Admin API Key");
  const headers = { accept: "application/json" };
  if (auth_mode === "bearer") headers.authorization = `Bearer ${key}`;
  else if (auth_mode === "basic") headers.authorization = `Basic ${Buffer.from(`admin:${key}`).toString("base64")}`;
  else headers["x-api-key"] = key;
  return headers;
}

async function remoteCPARequest({ base_url, admin_key, auth_mode }, method, pathname, body) {
  const base = normalizeBaseURL(base_url);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const headers = remoteCPAHeaders({ admin_key, auth_mode });
  const options = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const resp = await fetch(`${base}${path}`, options);
  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!resp.ok || (data && data.code !== undefined && data.code !== 0 && data.code !== "0")) {
    const detail = data?.message || data?.error || data?.code || data?.raw || resp.statusText;
    const err = new Error(`${method} ${path} failed: ${resp.status} ${typeof detail === "object" ? JSON.stringify(detail) : detail}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data?.data !== undefined ? data.data : data;
}

function remoteCPAQuery(filters = {}) {
  return encodeQuery({
    ids: filters.ids,
    platform: filters.platform || "openai",
    type: filters.type || "oauth",
    status: filters.status || "active",
    group: filters.group,
    search: filters.search,
    privacy_mode: filters.privacy_mode,
    sort_by: filters.sort_by || "priority",
    sort_order: filters.sort_order || "desc",
    include_proxies: filters.include_proxies === true ? "true" : "false",
  });
}

async function pullRemoteCPAData(connection, filters = {}) {
  return remoteCPARequest(connection, "GET", `/api/v1/admin/accounts/data${remoteCPAQuery(filters)}`);
}

function getNested(value, paths) {
  for (const path of paths) {
    let cur = value;
    let ok = true;
    for (const key of path) {
      if (cur == null || typeof cur !== "object" || !(key in cur)) { ok = false; break; }
      cur = cur[key];
    }
    if (ok && cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
  }
  return "";
}

const remotePaths = {
  access: [["credentials", "access_token"], ["access_token"], ["tokens", "access_token"], ["token_data", "access_token"]],
  refresh: [["credentials", "refresh_token"], ["refresh_token"], ["tokens", "refresh_token"], ["token_data", "refresh_token"]],
  expires: [["credentials", "expires_at"], ["expires_at"], ["expired"], ["token_data", "expired"]],
  email: [["credentials", "email"], ["email"], ["name"]],
  account: [["credentials", "chatgpt_account_id"], ["chatgpt_account_id"], ["account_id"]],
  quotaRemaining: [["quota_5h_remaining"], ["usage", "quota_5h_remaining"], ["quota", "remaining"], ["credentials", "quota_5h_remaining"]],
  quotaLimit: [["quota_5h_limit"], ["usage", "quota_5h_limit"], ["quota", "limit"], ["credentials", "quota_5h_limit"]],
  quotaUsed: [["quota_5h_used"], ["usage", "quota_5h_used"], ["quota", "used"], ["credentials", "quota_5h_used"]],
};

function explicitNoQuota(account) {
  const remainingRaw = getNested(account, remotePaths.quotaRemaining);
  const limitRaw = getNested(account, remotePaths.quotaLimit);
  const usedRaw = getNested(account, remotePaths.quotaUsed);
  const remaining = remainingRaw === "" ? NaN : Number(remainingRaw);
  const limit = limitRaw === "" ? NaN : Number(limitRaw);
  const used = usedRaw === "" ? NaN : Number(usedRaw);
  if (Number.isFinite(remaining) && remaining <= 0) return `quota_remaining=${remaining}`;
  if (Number.isFinite(limit) && Number.isFinite(used) && used >= limit) return `quota_used=${used}/${limit}`;
  return "";
}

function isReloginOrFatal(result) {
  const status = Number(result?.status || 0);
  const code = String(result?.code || "").toLowerCase();
  const error = String(result?.error || "").toLowerCase();
  if (status === 429 || code.includes("rate_limited") || error.includes("429")) return false;
  if (status === 401 || status === 402) return true;
  return /auth_unavailable|authentication_error|authentication token has been invalidated|token has been invalidated|invalidated|app_session_terminated|refresh_token_reused|invalid_grant|invalid_client|unauthorized|payment_required|billing|insufficient_quota|quota_exceeded|no[_ -]?quota|session has ended|signing in|sign in|log in|login|relogin|re-login/.test(`${code} ${error}`);
}

function classifyRemoteAccount(account, result, options = {}) {
  const quotaReason = explicitNoQuota(account);
  if (quotaReason) return { keep: false, reason: quotaReason };
  if (result?.ok) return { keep: true, reason: "refreshed_ok" };
  const refresh = getNested(account, remotePaths.refresh);
  const access = getNested(account, remotePaths.access);
  const expiresRaw = getNested(account, remotePaths.expires);
  const expiresAt = expiresRaw ? Date.parse(String(expiresRaw)) : NaN;
  if (result && (Number(result.status) === 429 || String(result.code || "").toLowerCase().includes("rate_limited") || String(result.error || "").includes("429"))) {
    return { keep: Boolean(refresh || access), reason: "rate_limited_429_not_abnormal" };
  }
  if (isReloginOrFatal(result)) return { keep: false, reason: result?.code || `http_${result?.status || 0}` };
  if (options.require_refresh_token !== false && !refresh) return { keep: false, reason: "missing_refresh_token" };
  if (!access && !refresh) return { keep: false, reason: "missing_access_and_refresh_token" };
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now() && !refresh) return { keep: false, reason: "expired_without_refresh_token" };
  return { keep: true, reason: result ? "non_fatal_refresh_failure_kept" : "no_error_marker" };
}

function remoteInvalidLogItem(account, index, result, reason) {
  const refresh = getNested(account, remotePaths.refresh);
  const access = getNested(account, remotePaths.access);
  return {
    index,
    id: account?.id,
    name: account?.name || account?.label || "",
    email: getNested(account, remotePaths.email),
    account_id: getNested(account, remotePaths.account),
    platform: account?.platform,
    type: account?.type,
    reason,
    status: result?.status || 0,
    code: result?.code || "",
    error: result?.error || "",
    access_fingerprint: fingerprintForLog(access),
    refresh_fingerprint: fingerprintForLog(refresh),
  };
}

function fingerprintForLog(value) {
  const text = String(value || "");
  if (!text) return "";
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function cleanRemoteCPAOnce(body) {
  const connection = {
    base_url: body.base_url,
    admin_key: body.admin_key || body.password,
    auth_mode: body.auth_mode || "x-api-key",
  };
  const filters = body.filters || {};
  const data = await pullRemoteCPAData(connection, filters);
  const originalAccounts = Array.isArray(data?.accounts) ? data.accounts : flattenInput(data);
  const refreshOptions = {
    ...(body.refresh_options || {}),
    token_url: body.refresh_options?.token_url || OPENAI_TOKEN_URL,
    client_id: body.refresh_options?.client_id || OPENAI_CODEX_CLIENT_ID,
    scope: body.refresh_options?.scope || OPENAI_REFRESH_SCOPE,
    user_agent: body.refresh_options?.user_agent || "codex-cli/0.91.0",
    exclusive: false,
    canonical_only: false,
  };
  const refreshResult = await refreshCPA(data, refreshOptions);
  const refreshedData = refreshResult.exported && typeof refreshResult.exported === "object" ? refreshResult.exported : data;
  const refreshedAccounts = Array.isArray(refreshedData?.accounts) ? refreshedData.accounts : flattenInput(refreshedData);
  const resultByIndex = new Map((refreshResult.results || []).map((item) => [item.index, item]));
  const keptAccounts = [];
  const invalid_log = [];
  for (let i = 0; i < originalAccounts.length; i++) {
    const candidate = refreshedAccounts[i] || originalAccounts[i];
    const result = resultByIndex.get(i) || null;
    const cls = classifyRemoteAccount(candidate, result, { require_refresh_token: body.require_refresh_token !== false });
    if (cls.keep) keptAccounts.push(candidate);
    else invalid_log.push(remoteInvalidLogItem(candidate, i, result, cls.reason));
  }
  const cleaned = Array.isArray(refreshedData?.accounts)
    ? { ...refreshedData, accounts: keptAccounts }
    : keptAccounts;
  let import_result = null;
  if (body.write_back === true) {
    import_result = await remoteCPARequest(connection, "POST", "/api/v1/admin/accounts/data", {
      data: cleaned,
      skip_default_group_bind: Boolean(body.skip_default_group_bind ?? true),
    });
  }
  return {
    ok: true,
    write_back: body.write_back === true,
    pulled: originalAccounts.length,
    kept: keptAccounts.length,
    dropped: invalid_log.length,
    refreshed: refreshResult.refreshed,
    failed: refreshResult.failed,
    skipped: refreshResult.skipped,
    refresh_results: refreshResult.results,
    invalid_log,
    cleaned,
    import_result,
  };
}

function isSensitiveName(name) {
  const n = String(name || "").toLowerCase();
  return /token|secret|cookie|authorization|(^|[-_])auth($|[-_])|password|passwd|api[-_]?key|refresh|access|id[-_]?token|session|credential/.test(n);
}

function looksSensitiveValue(value) {
  const text = String(value ?? "");
  return /\bBearer\s+[A-Za-z0-9._~+/=-]+|(?:sk|rt|sess|ak|pk)-[A-Za-z0-9._~+/=-]{8,}|(?:sk|rt|sess|ak|pk)_[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i.test(text);
}

function redactByName(name, value) {
  if (value == null) return value;
  const text = Array.isArray(value) ? value.join(",") : String(value);
  if (!captureRedact) return value;
  if (!isSensitiveName(name) && !looksSensitiveValue(text)) return value;
  return {
    redacted: true,
    length: text.length,
    sha256: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16),
  };
}

function redactObject(value, key = "") {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return redactByName(key, value);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, key));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactObject(v, k)]));
  }
  return String(value);
}

function redactedHeadersFromObject(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [
    key,
    redactByName(key, value),
  ]));
}

function redactedHeaders(req) {
  return redactedHeadersFromObject(req.headers);
}

function clientAddress(req) {
  return req.socket?.remoteAddress || "";
}

function pushCapture(event) {
  const item = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    observed_at: new Date().toISOString(),
    ...event,
  };
  captures.unshift(item);
  if (captures.length > captureLimit) captures.length = captureLimit;
  return item;
}

async function readRawBody(req, limit = 20 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求体太大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bodySummary(buffer, contentType = "") {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  const summary = {
    bytes: raw.length,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
  };
  if (!raw.length || raw.length > 128 * 1024) return summary;
  const text = raw.toString("utf8");
  if (/json/i.test(contentType) || /^[\s\r\n]*[\[{]/.test(text)) {
    try {
      summary[captureRedact ? "redacted_json" : "json"] = redactObject(JSON.parse(text));
      return summary;
    } catch {
      // fall through to text preview
    }
  }
  summary[captureRedact ? "redacted_text_preview" : "text_preview"] = String(redactObject({ body: text }).body).slice(0, 4096);
  return summary;
}

function hopByHopHeaders() {
  return new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);
}

function filteredForwardHeaders(req) {
  const skip = hopByHopHeaders();
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skip.has(key.toLowerCase()) && value != null) headers[key] = value;
  }
  return headers;
}

function proxyTargetURL(url) {
  const explicit = url.searchParams.get("target");
  if (explicit) return new URL(explicit);
  if (!proxyTargetBase) return null;
  const target = new URL(proxyTargetBase);
  const suffix = url.pathname.replace(/^\/proxy\/?/, "");
  target.pathname = path.posix.join(target.pathname, suffix);
  const params = new URLSearchParams(url.searchParams);
  params.delete("target");
  target.search = params.toString();
  return target;
}

async function handleProxy(req, res, url) {
  const target = proxyTargetURL(url);
  if (!target) return sendJSON(res, 400, { error: "missing proxy target: set PROXY_TARGET_BASE or pass ?target=https://..." });
  const body = await readRawBody(req);
  const requestCapture = pushCapture({
    type: "proxy_request",
    remote_addr: clientAddress(req),
    method: req.method,
    path: url.pathname,
    target: target.toString(),
    headers: redactedHeaders(req),
    body: bodySummary(body, req.headers["content-type"] || ""),
  });
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: filteredForwardHeaders(req),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      redirect: "manual",
    });
  } catch (err) {
    requestCapture.proxy_error = err.message;
    return sendJSON(res, 502, { error: "proxy_fetch_failed", message: err.message, capture_id: requestCapture.id });
  }
  const respBuffer = Buffer.from(await upstream.arrayBuffer());
  requestCapture.response = {
    status: upstream.status,
    headers: redactedHeadersFromObject(Object.fromEntries(upstream.headers.entries())),
    body: bodySummary(respBuffer, upstream.headers.get("content-type") || ""),
  };
  const outHeaders = {};
  const skip = hopByHopHeaders();
  for (const [key, value] of upstream.headers.entries()) {
    if (!skip.has(key.toLowerCase())) outHeaders[key] = value;
  }
  outHeaders["x-rt-refresh-capture-id"] = requestCapture.id;
  res.writeHead(upstream.status, outHeaders);
  res.end(respBuffer);
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求体太大");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.resolve(publicDir, "." + pathname);
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(target)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!checkAuth(req)) return sendUnauthorized(res);
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJSON(res, 200, {
        client_id: OPENAI_CODEX_CLIENT_ID,
        token_url: OPENAI_TOKEN_URL,
        oauth_auth_url: oauthAuthURL,
        oauth_token_url: oauthTokenURL,
        scope: OPENAI_REFRESH_SCOPE,
        auth_required: Boolean(authPassword),
        capture_redact: captureRedact,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/oauth/start") {
      cleanupOAuthSessions();
      const state = randomURLToken(24);
      const verifier = randomURLToken(64);
      const redirect_uri = oauthRedirectURI(req, url);
      const scope = url.searchParams.get("scope") || "openid email profile offline_access";
      const expiresAtMs = Date.now() + 10 * 60 * 1000;
      oauthSessions.set(state, {
        state,
        verifier,
        redirect_uri,
        scope,
        created_at: new Date().toISOString(),
        expires_at_ms: expiresAtMs,
      });
      const authorize_url = buildCodexAuthorizeURL({ state, verifier, redirect_uri, scope });
      return sendJSON(res, 200, {
        ok: true,
        provider: "openai_codex",
        authorize_url,
        state,
        redirect_uri,
        scope,
        expires_at: new Date(expiresAtMs).toISOString(),
        reference: "CLIProxyAPI GenerateAuthURL: PKCE S256, prompt=login, id_token_add_organizations=true, codex_cli_simplified_flow=true",
      });
    }
    if (req.method === "POST" && url.pathname === "/api/oauth/exchange") {
      cleanupOAuthSessions();
      const body = await readBody(req);
      const state = String(body.state || "");
      const code = String(body.code || "");
      const session = state ? oauthSessions.get(state) : null;
      if (!code) return sendJSON(res, 400, { error: "missing_code" });
      if (!session && !body.code_verifier) return sendJSON(res, 400, { error: "missing_or_expired_state", message: "没有找到 state；重新生成登录链接，或传 code_verifier 手动交换。" });
      if (session) oauthSessions.delete(state);
      const redirect_uri = body.redirect_uri || session?.redirect_uri || oauthRedirectURI(req, url);
      const code_verifier = body.code_verifier || session?.verifier;
      try {
        const exchanged = await exchangeCodexCode({ code, code_verifier, redirect_uri, client_id: body.client_id || OPENAI_CODEX_CLIENT_ID });
        const item = storeOAuthLogin({ ...exchanged, redirect_uri });
        return sendJSON(res, 200, { ok: true, id: item.id, canonical: item.canonical, token_response: item.token_response });
      } catch (err) {
        return sendJSON(res, err.status || 502, { error: err.message, data: err.data || null });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/remote-cpa/pull") {
      const body = await readBody(req);
      const data = await pullRemoteCPAData({
        base_url: body.base_url,
        admin_key: body.admin_key || body.password,
        auth_mode: body.auth_mode || "x-api-key",
      }, body.filters || {});
      const accounts = Array.isArray(data?.accounts) ? data.accounts : flattenInput(data);
      return sendJSON(res, 200, { ok: true, count: accounts.length, data });
    }
    if (req.method === "POST" && url.pathname === "/api/remote-cpa/clean") {
      const body = await readBody(req);
      const result = await cleanRemoteCPAOnce(body);
      return sendJSON(res, 200, result);
    }
    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      cleanupOAuthSessions();
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const errParam = url.searchParams.get("error");
      if (errParam) return sendHTML(res, 400, `<pre>OAuth error: ${escapeHTML(errParam)}\n${escapeHTML(url.searchParams.get("error_description") || "")}</pre>`);
      const session = oauthSessions.get(state);
      if (!code || !session) return sendHTML(res, 400, "<pre>缺少 code，或 state 已过期。请回到页面重新生成登录链接。</pre>");
      oauthSessions.delete(state);
      try {
        const exchanged = await exchangeCodexCode({ code, code_verifier: session.verifier, redirect_uri: session.redirect_uri });
        const item = storeOAuthLogin({ ...exchanged, redirect_uri: session.redirect_uri });
        return sendHTML(res, 200, oauthCallbackHTML(item));
      } catch (err) {
        return sendHTML(res, err.status || 502, `<pre>${escapeHTML(err.stack || err.message)}</pre>`);
      }
    }
    if (req.method === "GET" && url.pathname === "/api/oauth/latest") {
      return sendJSON(res, 200, {
        ok: true,
        count: oauthLogins.length,
        logins: oauthLogins.map((item) => ({
          id: item.id,
          created_at: item.created_at,
          provider: item.provider,
          label: item.label,
          redirect_uri: item.redirect_uri,
          canonical: item.canonical,
        })),
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/oauth/download/")) {
      const id = decodeURIComponent(url.pathname.replace("/api/oauth/download/", ""));
      const item = id === "latest" ? oauthLogins[0] : oauthLogins.find((x) => x.id === id);
      if (!item) return sendJSON(res, 404, { error: "oauth_login_not_found" });
      const safeLabel = String(item.label || "codex-oauth").replace(/[^a-zA-Z0-9@._-]+/g, "_").slice(0, 80) || "codex-oauth";
      return sendDownloadJSON(res, `${safeLabel}-${item.id}.json`, item.canonical);
    }
    if (req.method === "GET" && url.pathname === "/api/fingerprint") {
      const payload = {
        observed_at: new Date().toISOString(),
        remote_addr: clientAddress(req),
        method: req.method,
        url: url.pathname,
        headers: redactedHeaders(req),
        cli_header_hints: {
          claude: ["User-Agent", "X-Stainless-Package-Version", "X-Stainless-Runtime-Version", "X-Stainless-Os", "X-Stainless-Arch"],
          codex: ["User-Agent", "Originator", "OpenAI-Beta", "ChatGPT-Account-ID"],
        },
        note: "A browser request only exposes browser headers. Codex/Claude CLI headers appear here only when the CLI or a local companion calls this endpoint.",
        capture_redact: captureRedact,
      };
      pushCapture({ type: "fingerprint_request", remote_addr: clientAddress(req), method: req.method, path: url.pathname, headers: payload.headers });
      return sendJSON(res, 200, payload);
    }
    if (req.method === "GET" && url.pathname === "/api/captures") {
      return sendJSON(res, 200, { count: captures.length, captures });
    }
    if ((req.method === "DELETE" && url.pathname === "/api/captures") || (req.method === "POST" && url.pathname === "/api/captures/clear")) {
      captures.length = 0;
      return sendJSON(res, 200, { ok: true, count: 0 });
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readBody(req);
      return sendJSON(res, 200, analyzeInput(body.input ?? body.text ?? body));
    }
    if (req.method === "POST" && url.pathname === "/api/cli-report") {
      const body = await readBody(req);
      const item = pushCapture({
        type: "cli_companion_report",
        remote_addr: clientAddress(req),
        method: req.method,
        path: url.pathname,
        headers: redactedHeaders(req),
        report: redactObject(body),
      });
      return sendJSON(res, 200, { ok: true, id: item.id, stored: true });
    }
    if (req.method === "POST" && url.pathname === "/api/refresh") {
      const body = await readBody(req);
      const result = await refreshCPA(body.input ?? body.text ?? body, body.options || {});
      return sendJSON(res, result.ok ? 200 : 422, result);
    }
    if (url.pathname === "/proxy" || url.pathname.startsWith("/proxy/")) return handleProxy(req, res, url);
    if (req.method === "GET") return serveStatic(req, res);
    sendJSON(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    sendJSON(res, 400, { error: err.message || String(err) });
  }
});

server.listen(port, host, () => {
  console.log(`rt-refresh UI listening on ${host}:${port}`);
  console.log(authPassword ? `Password protection enabled for user "${authUser}".` : "Password protection disabled: set AUTH_PASSWORD or RT_REFRESH_PASSWORD to enable it.");
  console.log(captureRedact ? "Capture redaction enabled. Set CAPTURE_REDACT=false for raw captures." : "Capture redaction disabled: raw capture mode is enabled.");
  console.log("No credential persistence: imported CPA JSON stays in browser memory unless you export it.");
});
