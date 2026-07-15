#!/usr/bin/env node
/**
 * Atheris MCP server — exposes the Atheris proxy API as MCP tools so any
 * MCP-capable agent can pick a country with live stock, get a ready proxy URL,
 * and check its remaining GB. Zero dependencies (JSON-RPC 2.0 over stdio, node
 * global fetch).
 *
 * Env:
 *   ATHERIS_PROXY_KEY   your pak_ access key (required for proxy_url + usage)
 *   ATHERIS_API_BASE    default https://atheris.ee/api/v1
 *
 * Run:  ATHERIS_PROXY_KEY=pak_... node mcp/atheris-mcp.mjs
 */
const API = (process.env.ATHERIS_API_BASE || "https://atheris.ee/api/v1").replace(/\/$/, "");
const KEY = process.env.ATHERIS_PROXY_KEY || "";
const PROTOCOL = "2025-06-18";
const UA = "atheris-mcp/0.1.1";
const TIMEOUT_MS = 20_000;

const TOOLS = [
  {
    name: "atheris_stock",
    description:
      "List live Atheris proxy stock by country and pool (mbl = mobile 4G/5G, peer = residential). No key required. Call this before atheris_proxy_url to pick a country that has capacity.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "atheris_proxy_url",
    description:
      "Get a ready-to-use Atheris proxy URL for a country. Returns an http:// or socks5:// URL you can hand to any HTTP client. Requires ATHERIS_PROXY_KEY. NOTE: the returned proxy_url and password embed your pak_ key — treat the result as a secret; do not log it or echo it into transcripts.",
    inputSchema: {
      type: "object",
      properties: {
        country: { type: "string", description: "lowercase ISO code, e.g. us, gb, nl, br" },
        pool: { type: "string", enum: ["mbl", "peer"], description: "mbl=mobile, peer=residential (default mbl)" },
        session: { type: "string", description: "session id [a-z0-9_]{1,64}; SAME id = SAME exit IP. Use a distinct id per identity." },
        rotation: { type: "string", description: "sticky | sticky-strict | auto5 | auto10 | auto20 | auto30 | auto60 | hard | ondemand (default sticky)" },
        protocol: { type: "string", enum: ["http", "socks5"], description: "default http" },
        carrier: { type: "string", description: "optional mobile carrier, e.g. tmobile, orange" },
        city: { type: "string", description: "optional city, lowercase (availability varies by country/pool)" },
      },
      required: ["country"],
    },
  },
  {
    name: "atheris_usage",
    description: "Check the access key's remaining GB and expiry. Requires ATHERIS_PROXY_KEY.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function apiGet(path, auth) {
  const headers = { "user-agent": UA };
  if (auth) headers.authorization = `Bearer ${KEY}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    // Never let an upstream hang or network error wedge the MCP client — a
    // tool call must always resolve. TimeoutError fires at TIMEOUT_MS.
    const reason = e?.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : (e?.message ?? String(e));
    return { ok: false, status: 0, json: { error: `request failed: ${reason}` } };
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: `non-JSON response (${res.status})`, body: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function callTool(name, args = {}) {
  if ((name === "atheris_proxy_url" || name === "atheris_usage") && !KEY) {
    return { isError: true, text: "ATHERIS_PROXY_KEY is not set — required for this tool." };
  }
  if (name === "atheris_stock") {
    const r = await apiGet("/stock", false);
    return { isError: !r.ok, text: JSON.stringify(r.json, null, 2) };
  }
  if (name === "atheris_usage") {
    const r = await apiGet("/usage", true);
    return { isError: !r.ok, text: JSON.stringify(r.json, null, 2) };
  }
  if (name === "atheris_proxy_url") {
    const q = new URLSearchParams();
    for (const k of ["country", "pool", "session", "rotation", "protocol", "carrier", "city"]) {
      if (args[k]) q.set(k, String(args[k]));
    }
    const r = await apiGet(`/proxy?${q.toString()}`, true);
    return { isError: !r.ok, text: JSON.stringify(r.json, null, 2) };
  }
  return { isError: true, text: `unknown tool: ${name}` };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "atheris-mcp", version: "0.1.1" },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return; // notification, no reply
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    try {
      const r = await callTool(name, args);
      return ok(id, { content: [{ type: "text", text: r.text }], isError: r.isError });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: `error: ${e?.message ?? e}` }], isError: true });
    }
  }
  if (id !== undefined) return err(id, -32601, `method not found: ${method}`);
}

let buf = "";
const inFlight = new Set();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const p = handle(msg).catch(() => {});
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  }
});
// Drain in-flight tool calls before exiting — a client (or one-shot pipe)
// that closes stdin right after a request must still get its reply.
process.stdin.on("end", () => {
  Promise.allSettled([...inFlight]).then(() => process.exit(0));
});
