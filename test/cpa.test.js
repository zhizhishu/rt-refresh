import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { analyzeInput, normalizeEntry, refreshCPA } from "../src/cpa.js";

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
