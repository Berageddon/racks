import { createContext, useCallback, useContext, useState } from "react";
import { TOKEN_SYMBOL, TOKEN_CA, SWAP_LINKS } from "../token";
import { useTokenStats } from "../tokenStats";

const BuyContext = createContext(null);

export function BuyProvider({ children }) {
  const [open, setOpen] = useState(false);
  const openBuy = useCallback(() => setOpen(true), []);
  const closeBuy = useCallback(() => setOpen(false), []);

  return (
    <BuyContext.Provider value={{ openBuy, closeBuy }}>
      {children}
      <BuyModal open={open} onClose={closeBuy} />
    </BuyContext.Provider>
  );
}

export function useBuy() {
  return useContext(BuyContext);
}

function BuyModal({ open, onClose }) {
  const [copied, setCopied] = useState(false);
  const { stats } = useTokenStats();

  if (!open) return null;

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_CA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <div className="modal-title">Buy {TOKEN_SYMBOL}</div>
            <div className="modal-sub">The game currency on Robinhood Chain</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-links">
          {SWAP_LINKS.map((l) => (
            <a key={l.id} className="swap-link" href={l.url} target="_blank" rel="noreferrer">
              <div>
                <div className="swap-label">{l.label}</div>
                <div className="swap-note">{l.note}</div>
              </div>
              <span className="swap-arrow">↗</span>
            </a>
          ))}
        </div>

        <div className="modal-ca">
          <div>
            <div className="ca-label">{TOKEN_SYMBOL} contract</div>
            <div className="ca-value mono">{TOKEN_CA}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={copyCa}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="modal-stats">
          {stats.map((s) => (
            <div className="modal-stat" key={s.label}>
              <div className="ms-label">{s.label}</div>
              <div className="ms-value">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          Live figures straight from the chain and the pons launchpad pool. Bridge ETH for gas, then swap.
          Always confirm the contract address above against the official listing.
        </div>
      </div>
    </div>
  );
}