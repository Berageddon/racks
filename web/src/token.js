export const TOKEN_NAME = "RACKS";
export const TOKEN_SYMBOL = "$RACKS";
export const TOKEN_CA = import.meta.env.VITE_RACKS_TOKEN || "0x0000000000000000000000000000000000000000";

// $RACKS is a fixed-supply pons launch. Set by the launch config; fallback text.
export const TOKEN_SUPPLY_TEXT = "1,000,000,000";

// Steady-state trade fee per side on the pons AMM pool (launch config default is 1%).
// The one-off snipe tax applies only within the first seconds of launch, not steady-state.
// Update these if the pons launch fee settings differ when $RACKS launches.
export const BUY_TAX_TEXT = "1%";
export const SELL_TAX_TEXT = "1%";

export const SWAP_LINKS = [
  {
    id: "pons",
    label: "Pons launch",
    note: "Where $RACKS was born",
    // Point at the $RACKS token page once live, e.g. https://www.ponsfamily.com/launchpad/<TOKEN_CA>
    url: "https://www.ponsfamily.com/launchpad",
  },
  {
    id: "dex",
    label: "DEX pair",
    note: "Trade the liquidity pair",
    // Point at the $RACKS pool once live, e.g. https://www.gmgn.ai/chain/robinhood/token/<TOKEN_CA>
    url: "https://www.gmgn.ai",
  },
];