const $ = (id) => document.getElementById(id);

let currentEntries = [];
let selected = new Set();

function log(line) {
  $("log").textContent = `[${new Date().toLocaleTimeString()}] ${line}\n` + $("log").textContent;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
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
  $("summary").textContent = `共 ${entries.length} 条，${selected.size} 条可刷新。`;
  $("entries").innerHTML = entries.map((e) => `
    <label class="entry">
      <input type="checkbox" class="pick" data-index="${e.index}" ${selected.has(e.index) ? "checked" : ""} ${e.has_refresh_token ? "" : "disabled"} />
      <b>${escapeHTML(e.label)}</b>
      <small>AT# ${e.access_fingerprint || "none"}</small>
      <small>RT# ${e.refresh_fingerprint || "none"}</small>
      <small>exp ${escapeHTML(e.expires_at || "unknown")}</small>
      <span class="badge ${e.has_refresh_token ? "ok" : "warn"}">${e.has_refresh_token ? "RT OK" : "NO RT"}</span>
      ${e.plan_type ? `<span class="badge">${escapeHTML(e.plan_type)}</span>` : ""}
    </label>`).join("");
  document.querySelectorAll(".pick").forEach((box) => {
    box.addEventListener("change", () => {
      const idx = Number(box.dataset.index);
      if (box.checked) selected.add(idx); else selected.delete(idx);
      $("summary").textContent = `共 ${currentEntries.length} 条，选中 ${selected.size} 条刷新。`;
    });
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function analyze() {
  const input = $("input").value.trim();
  if (!input) return log("没有输入，解析空气呢？");
  const result = await api("/api/analyze", { input });
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
    $("output").value = pretty(result.exported);
    for (const r of result.results) {
      if (r.ok) log(`OK #${r.index}: AT#${r.access_fingerprint} RT#${r.refresh_fingerprint} rotated=${r.rotated_refresh_token}`);
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
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rt-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyOutput() {
  const text = $("output").value;
  if (!text.trim()) return log("没有导出内容。");
  await navigator.clipboard.writeText(text);
  log("已复制导出 JSON。");
}

$("file").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  $("input").value = await file.text();
  log(`已读取文件：${file.name}`);
  await analyze();
});
$("analyze").addEventListener("click", () => analyze().catch((e) => log(e.message)));
$("refresh").addEventListener("click", () => refresh().catch((e) => log(e.message)));
$("sample").addEventListener("click", sample);
$("clear").addEventListener("click", () => { $("input").value = ""; $("output").value = ""; $("entries").innerHTML = ""; currentEntries = []; selected.clear(); log("已清空。"); });
$("selectAll").addEventListener("click", () => {
  document.querySelectorAll(".pick:not(:disabled)").forEach((box) => { box.checked = true; selected.add(Number(box.dataset.index)); });
  $("summary").textContent = `共 ${currentEntries.length} 条，选中 ${selected.size} 条刷新。`;
});
$("download").addEventListener("click", download);
$("copy").addEventListener("click", () => copyOutput().catch((e) => log(e.message)));

loadConfig().catch((e) => log(e.message));
