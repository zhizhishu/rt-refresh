import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { analyzeInput, normalizeEntry, refreshCPA, toCanonicalCPA } from "../src/cpa.js";

function withMockTokenServer(handler) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      access_token: `at_new_${form.get("refresh_token")}`,
      refresh_token: `rt_new_${form.get("refresh_token")}`,
      id_token: "id_new",
      token_type: "Bearer",
      expires_in: 3600,
    }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        resolve(await handler(`http://127.0.0.1:${port}/oauth/token`));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function withMockTokenErrorServer(payload, status, handler) {
  const server = http.createServer(async (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        resolve(await handler(`http://127.0.0.1:${port}/oauth/token`));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

function withMockTokenSequenceServer(responses, handler) {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const next = responses[Math.min(calls, responses.length - 1)];
    calls++;
    if (next.status >= 400) {
      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(JSON.stringify(next.body));
      return;
    }
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(JSON.stringify(next.body || {
      access_token: `at_new_${form.get("refresh_token")}`,
      refresh_token: `rt_new_${form.get("refresh_token")}`,
      id_token: "id_new",
      token_type: "Bearer",
      expires_in: 3600,
    }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        resolve(await handler(`http://127.0.0.1:${port}/oauth/token`, () => calls));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test("analyze supports sub2api credentials shape", () => {
  const input = { accounts: [{ credentials: { access_token: "at", refresh_token: "rt", email: "a@example.test" } }] };
  const out = analyzeInput(JSON.stringify(input));
  assert.equal(out.count, 1);
  assert.equal(out.refreshable, 1);
  assert.equal(out.entries[0].email, "a@example.test");
});

test("normalize supports CLIProxyAPI codex auth shape", () => {
  const item = normalizeEntry({ type: "codex", access_token: "at", refresh_token: "rt", account_id: "acc" });
  assert.equal(item.credentials.access_token, "at");
  assert.equal(item.credentials.refresh_token, "rt");
  assert.equal(item.credentials.chatgpt_account_id, "acc");
});

test("canonical CLIProxy export preserves quota metadata", () => {
  const item = normalizeEntry({
    name: "quota",
    credentials: { access_token: "at", refresh_token: "rt" },
    quota_5h_remaining: 12,
    quota_weekly_limit: 300,
    quota_weekly_used: 18,
  });
  const out = toCanonicalCPA(item, { access_token: "at2", refresh_token: "rt2" });
  assert.equal(out.type, "codex");
  assert.equal(out.access_token, "at2");
  assert.equal(out.quota_5h_remaining, 12);
  assert.equal(out.quota_weekly_limit, 300);
  assert.equal(out.quota_weekly_used, 18);
});

test("analyze supports pasted raw rt lines", () => {
  const out = analyzeInput("rt_first_mock\nrt_second_mock");
  assert.equal(out.count, 2);
  assert.equal(out.refreshable, 2);
  assert.equal(out.entries[0].has_refresh_token, true);
});

test("refreshCPA rotates selected entries and exports only refreshed in exclusive mode", async () => {
  await withMockTokenServer(async (tokenURL) => {
    const input = {
      accounts: [
        { name: "keep", credentials: { access_token: "old-at", refresh_token: "old-rt" } },
        { name: "drop", credentials: { access_token: "no-rt" } },
      ],
    };
    const out = await refreshCPA(input, { token_url: tokenURL, exclusive: true });
    assert.equal(out.refreshed, 1);
    assert.equal(out.failed, 1);
    assert.equal(out.exported.accounts.length, 1);
    assert.equal(out.exported.accounts[0].credentials.access_token, "at_new_old-rt");
    assert.equal(out.exported.accounts[0].credentials.refresh_token, "rt_new_old-rt");
    assert.equal(out.results[0].rotated_refresh_token, true);
  });
});

test("refreshCPA can export canonical CPA auth array", async () => {
  await withMockTokenServer(async (tokenURL) => {
    const input = [{ type: "codex", access_token: "old-at", refresh_token: "old-rt", email: "me@example.test" }];
    const out = await refreshCPA(input, { token_url: tokenURL, canonical_only: true });
    assert.equal(Array.isArray(out.exported), true);
    assert.equal(out.exported[0].type, "codex");
    assert.equal(out.exported[0].access_token, "at_new_old-rt");
    assert.equal(out.exported[0].refresh_token, "rt_new_old-rt");
    assert.equal(out.exported[0].email, "me@example.test");
  });
});

test("refreshCPA can refresh pasted raw rt lines", async () => {
  await withMockTokenServer(async (tokenURL) => {
    const out = await refreshCPA("rt_raw_one\nrt_raw_two", { token_url: tokenURL, canonical_only: true });
    assert.equal(out.refreshed, 2);
    assert.equal(out.exported[0].refresh_token, "rt_new_rt_raw_one");
    assert.equal(out.exported[1].access_token, "at_new_rt_raw_two");
  });
});

test("refreshCPA summarizes unselected rows instead of returning skip spam", async () => {
  await withMockTokenServer(async (tokenURL) => {
    const input = [
      { type: "codex", access_token: "old-at-1", refresh_token: "old-rt-1" },
      { type: "codex", access_token: "old-at-2", refresh_token: "old-rt-2" },
    ];
    const out = await refreshCPA(input, { token_url: tokenURL, selected_indices: [0] });
    assert.equal(out.refreshed, 1);
    assert.equal(out.skipped, 1);
    assert.equal(out.results.some((r) => r.skipped), false);
  });
});

test("refreshCPA explains reused refresh token errors", async () => {
  await withMockTokenErrorServer({
    message: "Your refresh token has already been used to generate a new access token. Please try signing in again.",
    type: "invalid_request_error",
    code: "refresh_token_reused",
  }, 400, async (tokenURL) => {
    const input = [{ type: "codex", access_token: "old-at", refresh_token: "old-rt" }];
    const out = await refreshCPA(input, { token_url: tokenURL });
    assert.equal(out.failed, 1);
    assert.equal(out.results[0].code, "refresh_token_reused");
    assert.match(out.results[0].error, /必须使用那次返回的新 JSON\/新 RT/);
  });
});

test("refreshCPA retries transient refresh failures", async () => {
  await withMockTokenSequenceServer([
    { status: 429, body: { error: "rate_limited" } },
    { status: 200 },
  ], async (tokenURL, calls) => {
    const out = await refreshCPA([{ type: "codex", refresh_token: "rt_retry" }], {
      token_url: tokenURL,
      retry_attempts: 3,
      retry_backoff_ms: 1,
      canonical_only: true,
    });
    assert.equal(calls(), 2);
    assert.equal(out.refreshed, 1);
    assert.equal(out.results[0].attempts, 2);
  });
});

test("refreshCPA does not retry non-retryable refresh errors", async () => {
  await withMockTokenSequenceServer([
    { status: 400, body: { error: "invalid_grant" } },
    { status: 200 },
  ], async (tokenURL, calls) => {
    const out = await refreshCPA([{ type: "codex", refresh_token: "rt_dead" }], {
      token_url: tokenURL,
      retry_attempts: 3,
      retry_backoff_ms: 1,
    });
    assert.equal(calls(), 1);
    assert.equal(out.failed, 1);
    assert.equal(out.results[0].code, "invalid_grant");
  });
});
