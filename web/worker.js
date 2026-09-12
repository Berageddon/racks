const TOKEN_CA = "0xe88AC3eb472f7b6fe1e8Ae4fCb53dF48A731b352";
const PONS_URL = `https://www.ponsfamily.com/launchpad/${TOKEN_CA}`;
const CACHE_KEY = "https://racks/api/token-stats/pons";
const CACHE_TTL_MS = 30_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
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

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};