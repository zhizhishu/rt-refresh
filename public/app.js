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

function safeFileName(name, fallback = "codex-auth") {
  const base = String(name || fallback).replace(/\.jsonl?$/i, "").replace(/[^a-zA-Z0-9@._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (base || fallback).slice(0, 120);
}

function clickDownload(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return [JSON.parse(trimmed)]; } catch (err) { throw new Error(`${name} 不是合法 JSON: ${err.message}`); }
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch (err) { throw new Error(`${name} 第 ${i + 1} 行不是合法 JSON: ${err.message}`); }
  });
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
        exclusive: $("exclusive").checked,
        canonical_only: $("canonical").checked,
        selected_indices: [...selected],
      },
    });
    lastRefreshResult = result;
    $("output").value = pretty(result.exported);
    for (const r of result.results) {
      if (r.ok) log(`OK #${r.index}: AT#${r.access_fingerprint} RT#${r.refresh_fingerprint} ${r.rotated_refresh_token ? "返回新RT，旧RT可能失效" : "未返回新RT，旧RT不会因此失效"}`);
      else if (r.skipped) log(`SKIP #${r.index}: ${r.reason}`);
      else log(`FAIL #${r.index}: ${r.error}`);
    }
    log(`完成：成功 ${result.refreshed}，失败 ${result.failed}，exclusive=${result.exclusive}`);
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

function downloadEach() {
  if (lastRefreshResult?.canonical?.length) {
    const okResults = lastRefreshResult.results.filter((r) => r.ok);
    lastRefreshResult.canonical.forEach((item, i) => {
      const result = okResults[i] || {};
      const source = importedSourceNames[result.index] || item.email || item.account_id || `codex-${i + 1}`;
      clickDownload(pretty(item), `${safeFileName(source, `codex-${i + 1}`)}.json`);
    });
    log(`已触发 ${lastRefreshResult.canonical.length} 个刷新后单账号 JSON 下载。若浏览器拦截多文件下载，请允许此站点多文件下载。`);
    return;
  }

  const input = $("input").value.trim();
  if (!input) return log("没有可下载内容。先导入 JSON。");
  let docs;
  try {
    docs = flattenClientInput(JSON.parse(input));
  } catch (err) {
    return log(`当前输入不是合法 JSON，无法批量下载：${err.message}`);
  }
  if (!docs.length) return log("没有可下载的单账号 JSON。");
  docs.forEach((item, i) => {
    const source = importedSourceNames[i] || item?.email || item?.account_id || item?.credentials?.email || `codex-${i + 1}`;
    clickDownload(pretty(item), `${safeFileName(source, `codex-${i + 1}`)}.json`);
  });
  log(`未检测到刷新结果，已按当前导入内容触发 ${docs.length} 个单账号 JSON 下载。注意：这不是刷新后的凭证。`);
}

async function copyOutput() {
  const text = $("output").value;
  if (!text.trim()) return log("没有导出内容。");
  await navigator.clipboard.writeText(text);
  log("已复制导出 JSON。");
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
$("downloadEach").addEventListener("click", downloadEach);
$("copy").addEventListener("click", () => copyOutput().catch((e) => log(e.message)));

loadConfig().catch((e) => log(e.message));
