import crypto from "node:crypto";

export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_REFRESH_SCOPE = "openid profile email";

const PATHS = {
  access: [["credentials", "access_token"], ["tokens", "access_token"], ["token_data", "access_token"], ["access_token"], ["accessToken"], ["token"]],
  refresh: [["credentials", "refresh_token"], ["tokens", "refresh_token"], ["token_data", "refresh_token"], ["refresh_token"], ["refreshToken"]],
  id: [["credentials", "id_token"], ["tokens", "id_token"], ["token_data", "id_token"], ["id_token"], ["idToken"]],
  expires: [["credentials", "expires_at"], ["tokens", "expires_at"], ["token_data", "expired"], ["expired"], ["expires_at"], ["expiresAt"]],
  client: [["credentials", "client_id"], ["client_id"], ["clientId"]],
  scope: [["credentials", "scope"], ["tokens", "scope"], ["scope"]],
  email: [["credentials", "email"], ["email"], ["user", "email"]],
  account: [["credentials", "chatgpt_account_id"], ["chatgpt_account_id"], ["chatgptAccountId"], ["account_id"], ["accountId"], ["token_data", "account_id"], ["account", "id"]],
  user: [["credentials", "chatgpt_user_id"], ["chatgpt_user_id"], ["chatgptUserId"], ["user_id"], ["user", "id"]],
  org: [["credentials", "organization_id"], ["organization_id"], ["organizationId"], ["org_id"], ["orgId"]],
  plan: [["credentials", "plan_type"], ["plan_type"], ["planType"], ["account", "plan_type"], ["account", "planType"]],
};

export function loadInput(input) {
  if (typeof input !== "string") return input;
  const text = input.trim();
  if (!text) throw new Error("输入为空");
  if (isRefreshTokenLine(text)) return rawRefreshTokenToAuth(text, 0);
  if (text.includes("\n") && !text.startsWith("[") && !text.startsWith("{")) {
    return text.split(/\r?\n/).filter((line) => line.trim()).map((line, i) => {
      const cleaned = cleanTokenLine(line);
      if (isRefreshTokenLine(cleaned)) return rawRefreshTokenToAuth(cleaned, i);
      try { return JSON.parse(line); } catch (err) { throw new Error(`第 ${i + 1} 行不是合法 JSON，也不是 rt 开头的 RT: ${err.message}`); }
    });
  }
  return JSON.parse(text);
}

function cleanTokenLine(line) {
  return String(line || "").trim().replace(/^[`'"]+|[`'",;]+$/g, "");
}

function isRefreshTokenLine(line) {
  const text = cleanTokenLine(line);
  return /^rt[\w.-]{3,}$/i.test(text);
}

function rawRefreshTokenToAuth(line, index) {
  return {
    type: "codex",
    refresh_token: cleanTokenLine(line),
    label: `rt-${index + 1}`,
    client_id: OPENAI_CODEX_CLIENT_ID,
  };
}

export function flattenInput(value) {
  if (Array.isArray(value)) return value.flatMap(flattenInput);
  if (value && typeof value === "object") {
    for (const key of ["accounts", "items", "data"]) {
      if (Array.isArray(value[key])) return value[key].flatMap(flattenInput);
    }
  }
  return [value];
}

export function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function setPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (cur[key] == null || typeof cur[key] !== "object" || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[path[path.length - 1]] = value;
}

function firstString(obj, paths) {
  for (const path of paths) {
    const v = getPath(obj, path);
    if (typeof v === "string" && v.trim()) return { value: v.trim(), path };
    if (typeof v === "number") return { value: String(v), path };
  }
  return { value: "", path: null };
}

export function fingerprint(token) {
  const t = String(token || "").trim();
  if (!t) return "";
  return crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);
}

export function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function identityFromJwt(accessToken, idToken) {
  const claims = decodeJwtPayload(idToken) || decodeJwtPayload(accessToken) || {};
  const auth = claims["https://api.openai.com/auth"] || {};
  return {
    email: claims.email || "",
    account_id: auth.chatgpt_account_id || "",
    user_id: auth.chatgpt_user_id || auth.user_id || "",
    organization_id: auth.poid || (Array.isArray(auth.organizations) && auth.organizations[0]?.id) || "",
    plan_type: auth.chatgpt_plan_type || "",
  };
}

export function normalizeEntry(raw, index = 0) {
  const obj = raw && typeof raw === "object" ? raw : { access_token: String(raw || "") };
  const access = firstString(obj, PATHS.access);
  const refresh = firstString(obj, PATHS.refresh);
  const id = firstString(obj, PATHS.id);
  const expires = firstString(obj, PATHS.expires);
  const client = firstString(obj, PATHS.client);
  const scope = firstString(obj, PATHS.scope);
  const email = firstString(obj, PATHS.email);
  const account = firstString(obj, PATHS.account);
  const user = firstString(obj, PATHS.user);
  const org = firstString(obj, PATHS.org);
  const plan = firstString(obj, PATHS.plan);
  const jwtIdentity = identityFromJwt(access.value, id.value);
  const warnings = [];
  if (!refresh.value) warnings.push("missing_refresh_token");
  if (!access.value) warnings.push("missing_access_token");
  return {
    index,
    label: email.value || jwtIdentity.email || account.value || jwtIdentity.account_id || `entry-${index + 1}`,
    mutable: obj,
    paths: { access: access.path, refresh: refresh.path, id: id.path, expires: expires.path, client: client.path },
    credentials: {
      access_token: access.value,
      refresh_token: refresh.value,
      id_token: id.value,
      expires_at: expires.value,
      client_id: client.value || OPENAI_CODEX_CLIENT_ID,
      scope: scope.value,
      email: email.value || jwtIdentity.email,
      chatgpt_account_id: account.value || jwtIdentity.account_id,
      chatgpt_user_id: user.value || jwtIdentity.user_id,
      organization_id: org.value || jwtIdentity.organization_id,
      plan_type: plan.value || jwtIdentity.plan_type,
    },
    access_fingerprint: fingerprint(access.value),
    refresh_fingerprint: fingerprint(refresh.value),
    warnings,
  };
}

export function publicEntry(entry) {
  return {
    index: entry.index,
    label: entry.label,
    has_access_token: Boolean(entry.credentials.access_token),
    has_refresh_token: Boolean(entry.credentials.refresh_token),
    has_id_token: Boolean(entry.credentials.id_token),
    expires_at: entry.credentials.expires_at,
    email: entry.credentials.email,
    account_id: entry.credentials.chatgpt_account_id,
    user_id: entry.credentials.chatgpt_user_id,
    organization_id: entry.credentials.organization_id,
    plan_type: entry.credentials.plan_type,
    access_fingerprint: entry.access_fingerprint,
    refresh_fingerprint: entry.refresh_fingerprint,
    warnings: entry.warnings,
  };
}

export function analyzeInput(input) {
  const root = loadInput(input);
  const entries = flattenInput(root).map((item, index) => normalizeEntry(item, index));
  return {
    count: entries.length,
    refreshable: entries.filter((e) => e.credentials.refresh_token).length,
    entries: entries.map(publicEntry),
  };
}

export async function refreshToken({
  refresh_token,
  client_id = OPENAI_CODEX_CLIENT_ID,
  token_url = OPENAI_TOKEN_URL,
  scope = OPENAI_REFRESH_SCOPE,
  user_agent = "codex-cli/0.91.0",
  extra_form = {},
  timeout_ms = 120000,
}) {
  if (!refresh_token || !String(refresh_token).trim()) throw new Error("缺少 refresh_token");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeout_ms) || 120000);
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", String(refresh_token).trim());
  form.set("client_id", String(client_id || OPENAI_CODEX_CLIENT_ID).trim());
  form.set("scope", String(scope || OPENAI_REFRESH_SCOPE).trim());
  for (const [k, v] of Object.entries(extra_form || {})) {
    if (v != null && String(v).trim() !== "") form.set(k, String(v));
  }
  try {
    const resp = await fetch(token_url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": user_agent },
      body: form,
      signal: controller.signal,
    });
    const text = await resp.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!resp.ok) {
      const msg = formatOAuthError(data, text) || `HTTP ${resp.status}`;
      const err = new Error(`刷新失败: ${resp.status} ${msg}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}


function formatOAuthError(data, fallbackText = "") {
  const candidates = [data?.error_description, data?.error, data?.message, data?.raw, fallbackText];
  for (const value of candidates) {
    if (value == null || value === "") continue;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  try { return JSON.stringify(data); } catch { return String(data || ""); }
}

function oauthErrorCode(data) {
  for (const value of [data?.code, data?.error, data?.type]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function oauthErrorHint(data) {
  const code = oauthErrorCode(data);
  if (code === "refresh_token_reused") return "这个 RT 已经被用过；必须使用那次返回的新 JSON/新 RT，或重新登录获取新 RT。旧 RT 不能再刷新。";
  if (code === "app_session_terminated") return "这个会话已结束；需要重新登录获取新 RT。";
  if (code === "invalid_grant") return "RT 已失效、撤销或过期，不能靠刷新复活。";
  if (code === "invalid_scope") return "scope 不匹配；优先使用导入文件里的 scope。";
  if (code === "invalid_client") return "client_id 不匹配；检查是否应使用 Codex client_id。";
  return "";
}

export function applyRefresh(entry, tokenResp) {
  const now = new Date();
  const out = structuredClone(entry.mutable && typeof entry.mutable === "object" ? entry.mutable : {});
  const access = tokenResp.access_token || tokenResp.accessToken || "";
  const refresh = tokenResp.refresh_token || tokenResp.refreshToken || entry.credentials.refresh_token;
  const id = tokenResp.id_token || tokenResp.idToken || entry.credentials.id_token;
  const expiresIn = Number(tokenResp.expires_in || tokenResp.expiresIn || 0);
  const expiresAt = tokenResp.expires_at || tokenResp.expiresAt || (expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : entry.credentials.expires_at);
  setPath(out, entry.paths.access || ["access_token"], access);
  setPath(out, entry.paths.refresh || ["refresh_token"], refresh);
  if (id) setPath(out, entry.paths.id || ["id_token"], id);
  if (expiresAt) setPath(out, entry.paths.expires || ["expires_at"], expiresAt);
  if (entry.paths.client) setPath(out, entry.paths.client, entry.credentials.client_id || OPENAI_CODEX_CLIENT_ID);
  if ("last_refresh" in out || !entry.paths.access) out.last_refresh = now.toISOString();
  if ("expired" in out && expiresAt) out.expired = expiresAt;
  return out;
}

export function toCanonicalCPA(entry, tokenResp = {}) {
  const now = new Date();
  const access = tokenResp.access_token || tokenResp.accessToken || entry.credentials.access_token;
  const refresh = tokenResp.refresh_token || tokenResp.refreshToken || entry.credentials.refresh_token;
  const id = tokenResp.id_token || tokenResp.idToken || entry.credentials.id_token;
  const expiresIn = Number(tokenResp.expires_in || tokenResp.expiresIn || 0);
  const expiresAt = tokenResp.expires_at || tokenResp.expiresAt || (expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : entry.credentials.expires_at);
  const identity = identityFromJwt(access, id);
  return Object.fromEntries(Object.entries({
    type: "codex",
    access_token: access,
    refresh_token: refresh,
    id_token: id,
    account_id: entry.credentials.chatgpt_account_id || identity.account_id,
    email: entry.credentials.email || identity.email,
    chatgpt_user_id: entry.credentials.chatgpt_user_id || identity.user_id,
    organization_id: entry.credentials.organization_id || identity.organization_id,
    plan_type: entry.credentials.plan_type || identity.plan_type,
    last_refresh: now.toISOString(),
    expired: expiresAt,
    client_id: entry.credentials.client_id || OPENAI_CODEX_CLIENT_ID,
  }).filter(([, v]) => v !== undefined && v !== null && String(v) !== ""));
}

function replaceFlattened(root, replacementByIndex, exclusive) {
  let cursor = 0;
  function visit(value) {
    if (Array.isArray(value)) {
      const next = [];
      for (const item of value) {
        const v = visit(item);
        if (v !== undefined) next.push(v);
      }
      return next;
    }
    if (value && typeof value === "object") {
      for (const key of ["accounts", "items", "data"]) {
        if (Array.isArray(value[key])) {
          const copy = structuredClone(value);
          copy[key] = visit(value[key]);
          return copy;
        }
      }
      const idx = cursor++;
      if (replacementByIndex.has(idx)) return replacementByIndex.get(idx).preserved;
      return exclusive ? undefined : structuredClone(value);
    }
    const idx = cursor++;
    if (replacementByIndex.has(idx)) return replacementByIndex.get(idx).preserved;
    return exclusive ? undefined : value;
  }
  return visit(root);
}

export async function refreshCPA(input, options = {}) {
  const root = loadInput(input);
  const entries = flattenInput(root).map((item, index) => normalizeEntry(item, index));
  const selected = new Set(Array.isArray(options.selected_indices) ? options.selected_indices.map(Number) : entries.map((e) => e.index));
  const includeSkippedDetails = Boolean(options.include_skipped_details);
  const replacementByIndex = new Map();
  const results = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!selected.has(entry.index)) {
      skipped++;
      if (includeSkippedDetails) results.push({ index: entry.index, label: entry.label, skipped: true, reason: "not_selected" });
      continue;
    }
    if (!entry.credentials.refresh_token) {
      results.push({ index: entry.index, label: entry.label, ok: false, error: "missing_refresh_token" });
      continue;
    }
    try {
      const tokenResp = await refreshToken({
        refresh_token: entry.credentials.refresh_token,
        client_id: options.client_id || entry.credentials.client_id || OPENAI_CODEX_CLIENT_ID,
        token_url: options.token_url || OPENAI_TOKEN_URL,
        scope: options.scope || entry.credentials.scope || OPENAI_REFRESH_SCOPE,
        user_agent: options.user_agent || "codex-cli/0.91.0",
        extra_form: options.extra_form || {},
        timeout_ms: options.timeout_ms,
      });
      const preserved = applyRefresh(entry, tokenResp);
      const canonical = toCanonicalCPA(entry, tokenResp);
      replacementByIndex.set(entry.index, { preserved, canonical });
      results.push({
        index: entry.index,
        label: entry.label,
        ok: true,
        rotated_refresh_token: Boolean((tokenResp.refresh_token || tokenResp.refreshToken) && (tokenResp.refresh_token || tokenResp.refreshToken) !== entry.credentials.refresh_token),
        access_fingerprint: fingerprint(tokenResp.access_token || tokenResp.accessToken),
        refresh_fingerprint: fingerprint(tokenResp.refresh_token || tokenResp.refreshToken || entry.credentials.refresh_token),
        expires_at: canonical.expired || "",
      });
    } catch (err) {
      const hint = oauthErrorHint(err.data || {});
      results.push({
        index: entry.index,
        label: entry.label,
        ok: false,
        error: hint ? `${err.message} | 提示: ${hint}` : err.message,
        status: err.status || 0,
        code: oauthErrorCode(err.data || {}),
      });
    }
  }
  const refreshedEntries = [...replacementByIndex.values()];
  const canonicalOnly = Boolean(options.canonical_only);
  const exclusive = Boolean(options.exclusive ?? true);
  return {
    ok: results.some((r) => r.ok),
    total: entries.length,
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => r.ok === false).length,
    skipped,
    exclusive,
    exported: canonicalOnly ? refreshedEntries.map((x) => x.canonical) : replaceFlattened(root, replacementByIndex, exclusive),
    canonical: refreshedEntries.map((x) => x.canonical),
    results,
  };
}
