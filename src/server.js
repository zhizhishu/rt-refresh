import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeInput, refreshCPA, OPENAI_CODEX_CLIENT_ID, OPENAI_TOKEN_URL, OPENAI_REFRESH_SCOPE } from "./cpa.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 8787);

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
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJSON(res, 200, {
        client_id: OPENAI_CODEX_CLIENT_ID,
        token_url: OPENAI_TOKEN_URL,
        scope: OPENAI_REFRESH_SCOPE,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readBody(req);
      return sendJSON(res, 200, analyzeInput(body.input ?? body.text ?? body));
    }
    if (req.method === "POST" && url.pathname === "/api/refresh") {
      const body = await readBody(req);
      const result = await refreshCPA(body.input ?? body.text ?? body, body.options || {});
      return sendJSON(res, result.ok ? 200 : 422, result);
    }
    if (req.method === "GET") return serveStatic(req, res);
    sendJSON(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    sendJSON(res, 400, { error: err.message || String(err) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`rt-refresh UI: http://127.0.0.1:${port}`);
  console.log("No credential persistence: imported CPA JSON stays in browser memory unless you export it.");
});
