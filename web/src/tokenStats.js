import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { robinhoodChain, TOKEN_ADDRESS } from "./config";
import { erc20Abi } from "./contracts/erc20Abi";
import { TOKEN_SUPPLY_TEXT, BUY_TAX_TEXT, SELL_TAX_TEXT } from "./token";

const intFmt = new Intl.NumberFormat("en-US");

const fmtUsd = (v) => {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(2)}`;
};

const fmtSupply = (raw) => intFmt.format(BigInt(raw.toString()) / 10n ** 18n);

async function fetchLive(publicClient) {
  const token = TOKEN_ADDRESS;

  let supply = null;
  try {
    supply = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" });
  } catch (_) {}

  let price = null;
  let liquidity = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    const j = await res.json();
    const pairs = (j?.pairs || [])
      .filter((p) => p?.chainId === "robinhood")
      .map((p) => ({ liq: Number(p.liquidity?.usd) || 0, price: Number(p.priceUsd) || 0 }))
      .sort((a, b) => b.liq - a.liq);
    const top = pairs[0];
    if (top && top.price > 0) {
      price = top.price;
      if (top.liq > 0) liquidity = top.liq;
    }
  } catch (_) {}

  let holders = null;
  try {
    const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${token}/counters`);
    const j = await res.json();
    holders = j?.token_holders_count ?? null;
  } catch (_) {}

  return { supply, price, liquidity, holders };
}

// Live $RACKS market snapshot. Rates the primary pair by liquidity, mirrors the pons
// listing (same pool), and falls back gracefully when a source is unreachable.
export function useTokenStats() {
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { data } = useQuery({
    queryKey: ["token-stats", TOKEN_ADDRESS || "unconfigured"],
    queryFn: () => fetchLive(publicClient),
    enabled: !!TOKEN_ADDRESS && !!publicClient,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const supplyNum = data?.supply != null ? Number(data.supply) / 1e18 : null;
  const marketCap =
    data?.price != null && supplyNum != null && supplyNum > 0 ? data.price * supplyNum : null;

  const stats = [
    { label: "Price", value: fmtUsd(data?.price) },
    { label: "Market cap", value: fmtUsd(marketCap) },
    { label: "Total supply", value: data?.supply != null ? fmtSupply(data.supply) : TOKEN_SUPPLY_TEXT },
    { label: "Liquidity", value: fmtUsd(data?.liquidity) },
    { label: "Holders", value: data?.holders != null ? intFmt.format(data.holders) : "—" },
    { label: "Buy / sell tax", value: `${BUY_TAX_TEXT} / ${SELL_TAX_TEXT}` },
  ];

  return { stats };
}