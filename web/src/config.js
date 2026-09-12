import { defineChain, http } from "viem";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

// Robinhood Chain RPCs, used only as chain metadata (explorer/etc.).
// In-browser requests NEVER hit these directly: the upstream RPCs were
// intermittently 403-ing browser requests, so all chain reads are proxied
// same-origin through our worker's /rpc endpoint (?chain=<id>).
const RH_MAINNET_RPCS = ["https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com"];

// Robinhood Chain (mainnet, chain id 4663)
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  network: "robinhood-chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: RH_MAINNET_RPCS },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

// Robinhood Chain testnet (chain id 46630)
export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  network: "robinhood-chain-testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
});

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "YOUR_WALLETCONNECT_PROJECT_ID";

export const wagmiConfig = getDefaultConfig({
  appName: "RACKS",
  projectId,
  chains: [robinhoodChain, robinhoodChainTestnet],
  transports: {
    [robinhoodChain.id]: http("/rpc?chain=4663", { batch: true, retryCount: 2, timeout: 15000 }),
    [robinhoodChainTestnet.id]: http("/rpc?chain=46630", { batch: true, retryCount: 2, timeout: 15000 }),
  },
  ssr: false,
});

// --- Contract addresses (set in web/.env) ---
export const GAME_ADDRESS = import.meta.env.VITE_RACKS_GAME;
export const TOKEN_ADDRESS = import.meta.env.VITE_RACKS_TOKEN;

// --- Public source & audit trail (github.com/Berageddon/racks) ---
export const X_URL = "https://x.com/rhracks";
export const GITHUB_REPO_URL = "https://github.com/Berageddon/racks";
export const ADERYN_REPORT_URL = `${GITHUB_REPO_URL}/blob/master/audit/aderyn-report.md`;
export const SLITHER_REPORT_URL = `${GITHUB_REPO_URL}/blob/master/audit/slither-report.md`;
export const AUDIT_CI_URL = `${GITHUB_REPO_URL}/actions`;

const fmt = (n, d = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(Number(n));

// Format a raw 10^18-denominated amount into human text ($RACKS has 18 decimals).
export const formatRacks = (raw) => {
  if (!raw) return "0";
  const val = BigInt(raw.toString());
  const whole = val / 10n ** 18n;
  const frac = val % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 2);
  return `${fmt(whole)}.${fracStr}`;
};

export const shortAddr = (addr) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";