export const TOKEN_NAME = "RACKS";
export const TOKEN_SYMBOL = "$RACKS";
export const TOKEN_CA = import.meta.env.VITE_RACKS_TOKEN || "0x0000000000000000000000000000000000000000";

// $RACKS is a fixed-supply pons launch. Set by the launch config; fallback text.
export const TOKEN_SUPPLY_TEXT = "1,000,000,000";

// Steady-state trade fee per side on the pons AMM pool (set at launch).
export const BUY_TAX_TEXT = "2%";
export const SELL_TAX_TEXT = "2%";

const PONS_TOKEN_URL = "https://www.ponsfamily.com/launchpad/0xe88AC3eb472f7b6fe1e8Ae4fCb53dF48A731b352";

export const SWAP_LINKS = [
  {
    id: "pons",
    label: "Pons launch",
    note: "Where $RACKS was born",
    url: PONS_TOKEN_URL,
  },
  {
    id: "dex",
    label: "DEX pair",
    note: "Trade the liquidity pair",
    url: "https://gmgn.ai/robinhood/token/0xe88AC3eb472f7b6fe1e8Ae4fCb53dF48A731b352",
  },
];