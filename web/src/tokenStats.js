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
  return `$${Number(n.toPrecision(4))}`;
};

const fmtSupply = (raw) => intFmt.format(BigInt(raw.toString()) / 10n ** 18n);

async function fetchLive(publicClient) {
  const token = TOKEN_ADDRESS;

  let supply = null;
  try {
    supply = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" });
  } catch (_) {}

  // Price / market cap / market type come from the pons launchpad via our
  // own Cloudflare worker proxy (direct browser fetches to pons are CORS-blocked).
  let market = null;
  try {
    const res = await fetch("/api/token-stats");
    if (res.ok) {
      const j = await res.json();
      if (typeof j.priceUsd === "number" && j.priceUsd >= 0) market = j;
    }
  } catch (_) {}

  let holders = null;
  try {
    const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${token}`);
    const j = await res.json();
    holders = j?.holders_count ?? null;
  } catch (_) {}

  return { supply, price: market?.priceUsd ?? null, marketCap: market?.marketCapUsd ?? null, marketName: market?.market ?? null, holders };
}

// Live $RACKS market snapshot. Market figures mirror the pons launchpad listing
// (same pool), with supply and holders read from the chain.
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
    data?.marketCap != null
      ? data.marketCap
      : data?.price != null && supplyNum != null && supplyNum > 0
      ? data.price * supplyNum
      : null;

  const stats = [
    { label: "Price", value: fmtUsd(data?.price) },
    { label: "Market cap", value: fmtUsd(marketCap) },
    { label: "Total supply", value: data?.supply != null ? fmtSupply(data.supply) : TOKEN_SUPPLY_TEXT },
    { label: "Market", value: data?.marketName || "—" },
    { label: "Holders", value: data?.holders != null ? intFmt.format(data.holders) : "—" },
    { label: "Buy / sell tax", value: `${BUY_TAX_TEXT} / ${SELL_TAX_TEXT}` },
  ];

  return { stats };
}