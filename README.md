<!-- SOURCE OF TRUTH: this monorepo mcp/ directory. Any change to atheris-mcp.mjs
     or this README must be pushed to the public mirror (github.com/atheris-ee/
     atheris-mcp) and, if the server changed, published to npm as atheris-mcp. -->
# atheris-mcp

An [MCP](https://modelcontextprotocol.io) server for [Atheris](https://atheris.ee)
proxies — real-carrier 4G/5G mobile and residential IPs, per gigabyte. It gives an
agent a fully autonomous path to route traffic through a specific-country IP: check
live stock, get a ready-to-use proxy URL, and check remaining GB — all as tool calls.

Zero dependencies. One file. Node ≥ 18.

## Tools

- **`atheris_stock`** — live proxy stock by country and pool (`mbl` = mobile,
  `peer` = residential). No key needed. Call it first to pick a country with capacity.
- **`atheris_proxy_url`** — a ready `http://` or `socks5://` proxy URL for a
  country/pool/session/rotation. Hand it straight to any HTTP client.
- **`atheris_usage`** — the key's remaining GB and expiry.

## Setup

You need an Atheris access key (`pak_…`) from the [dashboard](https://atheris.ee/dashboard).

Straight from GitHub (no install):

```jsonc
// Claude Desktop / Claude Code / Cursor / any MCP client
{
  "mcpServers": {
    "atheris": {
      "command": "npx",
      "args": ["-y", "github:atheris-ee/atheris-mcp"],
      "env": { "ATHERIS_PROXY_KEY": "pak_your_key_here" }
    }
  }
}
```

Or from a local checkout:

```jsonc
{
  "mcpServers": {
    "atheris": {
      "command": "node",
      "args": ["/path/to/atheris-mcp.mjs"],
      "env": { "ATHERIS_PROXY_KEY": "pak_your_key_here" }
    }
  }
}
```

Env:
- `ATHERIS_PROXY_KEY` — your pak access key (required for `atheris_proxy_url`
  and `atheris_usage`; `atheris_stock` works without it).
- `ATHERIS_API_BASE` — defaults to `https://atheris.ee/api/v1`. Your key is sent
  as a Bearer token to whatever host this names, so only point it at a host you
  trust.

The key is the same credential used as the proxy password — treat it like one.
Keep it in `env`, not in command args, and rotate it from the dashboard if it
leaks. The server talks only to `atheris.ee` (or your `ATHERIS_API_BASE`) and
collects no telemetry.

**The `atheris_proxy_url` result is also a secret.** Both its `proxy_url` and
`password` fields embed your pak key — treat the tool's output like the key
itself: don't log it or paste it into shared transcripts.

## Session rule (important)

Each `atheris_proxy_url` call takes a `session` id. **The same session id returns the
same exit IP.** For many parallel identities (scraping distinct hosts, running many
antidetect profiles), give each identity its own session id — reusing one sticky
session across many pins them all to a single exit. Use `rotation: "hard"` if you want
a fresh exit on every connection instead.

## The underlying HTTP API

The server is a thin wrapper over the Atheris JSON API (bearer-authed with your pak key):

- `GET /api/v1/stock`
- `GET /api/v1/proxy?country=us&pool=mbl&session=<id>&rotation=sticky&protocol=http`
- `GET /api/v1/usage`

See <https://atheris.ee/llms-full.txt> for the full agent reference, including
buying access programmatically.

## License

MIT © [Arvane Holdings OÜ](https://atheris.ee)
