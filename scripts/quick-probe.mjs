#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const pref = process.argv.find((x) => x.startsWith(`${name}=`));
  return pref ? pref.slice(name.length + 1) : fallback;
}

function hasFlag(...names) {
  return names.some((name) => process.argv.includes(name));
}

function trimBase(value) {
  return String(value || "http://127.0.0.1:8787").replace(/\/+$/, "");
}

function authHeader(basicAuth) {
  return basicAuth ? `Basic ${Buffer.from(basicAuth).toString("base64")}` : "";
}

async function requestJSON(url, { method = "GET", basicAuth = "", headers = {}, body } = {}) {
  const finalHeaders = { ...headers };
  const authorization = authHeader(basicAuth);
  if (authorization) finalHeaders.authorization = authorization;
  if (body !== undefined && !finalHeaders["content-type"]) finalHeaders["content-type"] = "application/json";
  const resp = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!resp.ok) throw new Error(`${method} ${url} failed ${resp.status}: ${text}`);
  return data;
}

async function main() {
  const base = trimBase(argValue("--base", process.env.RT_REFRESH_BASE || ""));
  const basicAuth = argValue("--basic-auth", process.env.RT_REFRESH_BASIC_AUTH || "");
  const raw = hasFlag("--raw", "--no-redact") || ["0", "false", "no", "off", "raw"].includes(String(process.env.RT_REFRESH_REDACT ?? "").toLowerCase());
  const proxyTarget = argValue("--proxy-target", process.env.RT_REFRESH_PROXY_TARGET || "");
  const companion = path.join(__dirname, "cli-companion.mjs");
  const endpoint = `${base}/api/cli-report`;

  const fingerprint = await requestJSON(`${base}/api/fingerprint`, {
    basicAuth,
    headers: {
      "user-agent": "codex-cli/0.91.0 rt-refresh-quick-probe",
      "originator": "codex_cli_rs",
      "openai-beta": "rt-refresh-ctf-probe",
      "x-rt-refresh-probe": raw ? "raw" : "redacted",
    },
  });

  let proxy = null;
  if (proxyTarget) {
    proxy = await requestJSON(`${base}/proxy?target=${encodeURIComponent(proxyTarget)}`, {
      method: "POST",
      basicAuth,
      headers: {
        "user-agent": "rt-refresh-quick-probe/1.0",
        "x-quick-probe-token": "rt_quick_probe_header_1234567890",
      },
      body: {
        kind: "rt-refresh-quick-probe",
        refresh_token: "rt_quick_probe_body_1234567890",
        raw,
      },
    });
  }

  const companionArgs = ["--endpoint", endpoint];
  if (basicAuth) companionArgs.push("--basic-auth", basicAuth);
  if (raw) companionArgs.push("--no-redact");
  const companionResult = await execFileAsync(process.execPath, [companion, ...companionArgs], {
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      RT_REFRESH_REDACT: raw ? "false" : (process.env.RT_REFRESH_REDACT || "true"),
    },
  });

  const captures = await requestJSON(`${base}/api/captures`, { basicAuth });
  const summary = {
    ok: true,
    base,
    raw,
    fingerprint_observed: Boolean(fingerprint.observed_at),
    companion_upload: JSON.parse(companionResult.stdout || "{}"),
    proxy_test: proxy ? { ok: true } : { skipped: true, hint: "需要代理转发时加 --proxy-target https://example.test/path" },
    capture_count: captures.count,
    next: "打开网页的 0b. 一键捕获 / CLI 捕获 面板，点“刷新捕获”。",
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
