const TOKEN_CA = "0xe88AC3eb472f7b6fe1e8Ae4fCb53dF48A731b352";
const PONS_URL = `https://www.ponsfamily.com/launchpad/${TOKEN_CA}`;
const CACHE_KEY = "https://racks/api/token-stats/pons";
const CACHE_TTL_MS = 30_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Chain reads are proxied through /rpc so the browser never hits the upstream RPC
// directly (PublicNode was 403-ing CORS-flavoured browser requests). The worker
// picks the upstream by ?chain= — same body is forwarded verbatim.
const RPC_UPSTREAMS = {
  "4663": "https://robinhood-rpc.publicnode.com",
  "46630": "https://rpc.testnet.chain.robinhood.com",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function dtValue(html, open) {
  const i = html.indexOf(open);
  if (i === -1) return null;
  const s = html.indexOf("<dd>", i);
  if (s === -1) return null;
  const e = html.indexOf("</dd>", s);
  if (e === -1) return null;
  return html.slice(s + 4, e).replace(/<!--[\s\S]*?-->/g, "").trim();
}

function money(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parsePons(html) {
  const priceUsd = money(dtValue(html, "<dt>Price</dt>"));
  const marketCapUsd = money(dtValue(html, "<dt>Market cap</dt>"));
  const priceEthRaw = dtValue(html, "<dt>Price in");
  const priceEth = priceEthRaw ? money(priceEthRaw.replace(/ ETH$/, "")) : null;
  const market = dtValue(html, "<dt>Market</dt>");
  return { priceUsd, marketCapUsd, priceEth, market, source: "pons" };
}

function json(body, extraHeaders = {}) {
  const { status = 200 } = extraHeaders;
  const headers = { "Content-Type": "application/json" };
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (k !== "status") headers[k] = v;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchFresh() {
  const res = await fetch(PONS_URL, { headers: { "User-Agent": BROWSER_UA, "Accept": "text/html" } });
  if (!res.ok) throw new Error(`pons ${res.status}`);
  const html = await res.text();
  const parsed = parsePons(html);
  if (parsed.priceUsd == null && parsed.marketCapUsd == null) throw new Error("pons parse failed");
  return { ...parsed, fetchedAt: Date.now() };
}

async function tokenStats(ctx) {
  const cache = caches.default;
  let cached = null;
  try {
    cached = await cache.match(CACHE_KEY);
  } catch (_) {}

  if (cached) {
    try {
      const j = await cached.json();
      if (Date.now() - (j.fetchedAt || 0) < CACHE_TTL_MS) return j;
    } catch (_) {}
  }

  try {
    const fresh = await fetchFresh();
    try {
      ctx.waitUntil(cache.put(CACHE_KEY, json(fresh)));
    } catch (_) {}
    return fresh;
  } catch (err) {
    if (cached) {
      try {
        const j = await cached.json();
        return { ...j, stale: true };
      } catch (_) {}
    }
    throw err;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/token-stats") {
      try {
        const data = await tokenStats(ctx);
        return json(data, { "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*" });
      } catch (err) {
        return json({ error: "unavailable", message: String((err && err.message) || err) }, {
          status: 502,
          "Cache-Control": "no-store",
        });
      }
    }

    if (url.pathname === "/api/" || url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404, "Cache-Control": "no-store" });
    }

    // JSON-RPC proxy: forward the whole body to the chain RPC selected by ?chain=.
    if (url.pathname === "/rpc") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "POST") {
        return new Response('{"error":"method_not_allowed"}', {
          status: 405,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const upstream = RPC_UPSTREAMS[url.searchParams.get("chain") || "4663"];
      if (!upstream) {
        return new Response('{"error":"bad_chain"}', {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      try {
        const rpcRes = await fetch(upstream, {
          method: "POST",
          headers: {
            "Content-Type": request.headers.get("Content-Type") || "application/json",
            Accept: "application/json",
          },
          body: request.body,
        });
        const body = await rpcRes.arrayBuffer();
        return new Response(body, {
          status: rpcRes.status,
          headers: {
            ...CORS,
            "Content-Type": rpcRes.headers.get("Content-Type") || "application/json",
            "Cache-Control": "no-store",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "rpc_upstream_failed", message: String((err && err.message) || err) }), {
          status: 502,
          headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }

    // Everything else ships the static app. The ASSETS binding serves real files;
    // anything unknown falls back to index.html so the SPA keeps working.
    if (env.ASSETS) {
      let res = await env.ASSETS.fetch(request);
      if (res.status === 404 && (request.method === "GET" || request.method === "HEAD")) {
        const spaUrl = new URL("./index.html", url.origin);
        const spa = await env.ASSETS.fetch(new Request(`${spaUrl.origin}${spaUrl.pathname}`, request));
        if (spa.status === 200) {
          res = new Response(spa.body, { status: 200, statusText: "OK", headers: spa.headers });
        }
      }
      return res;
    }
    return new Response("Not found", { status: 404 });
  },
};