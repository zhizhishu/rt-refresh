import http from "node:http";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeInput, refreshCPA, OPENAI_CODEX_CLIENT_ID, OPENAI_TOKEN_URL, OPENAI_REFRESH_SCOPE } from "./cpa.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const captureLimit = Number(process.env.CAPTURE_LIMIT || 500);
const proxyTargetBase = process.env.PROXY_TARGET_BASE || "";
const authUser = process.env.AUTH_USER || process.env.RT_REFRESH_USER || "admin";
const authPassword = process.env.AUTH_PASSWORD || process.env.RT_REFRESH_PASSWORD || "";
const authRealm = process.env.AUTH_REALM || "rt-refresh";
const captureRedact = !["0", "false", "no", "off", "raw"].includes(String(process.env.CAPTURE_REDACT ?? "true").toLowerCase());
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
        scope: OPENAI_REFRESH_SCOPE,
        auth_required: Boolean(authPassword),
        capture_redact: captureRedact,
      });
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
  const shownHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`rt-refresh UI: http://${shownHost}:${port}`);
  console.log(authPassword ? `Password protection enabled for user "${authUser}".` : "Password protection disabled: set AUTH_PASSWORD or RT_REFRESH_PASSWORD to enable it.");
  console.log(captureRedact ? "Capture redaction enabled. Set CAPTURE_REDACT=false for raw CTF captures." : "Capture redaction disabled: raw capture mode is enabled.");
  console.log("No credential persistence: imported CPA JSON stays in browser memory unless you export it.");
});
