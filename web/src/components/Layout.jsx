import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import WalletButton from "./WalletButton";
import GitHubIcon from "./GitHubIcon";
import XIcon from "./XIcon";
import { useBuy } from "./BuyModal";
import { GITHUB_REPO_URL, ADERYN_REPORT_URL, SLITHER_REPORT_URL, AUDIT_CI_URL, X_URL } from "../config";

export default function Layout() {
  const { openBuy } = useBuy();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <div className="logo">
            <Link to="/">
              <img src="/rack.png" alt="RACKS" className="logo-img" />
              <span className="logo-text">RACKS</span>
            </Link>
          </div>

          <nav className="nav">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/play">Play</NavLink>
            <NavLink to="/docs">Docs</NavLink>
          </nav>

          <div className="header-cta">
            <button className="btn-buy" onClick={openBuy} aria-label="Buy RACKS">
              <span className="plus">+</span>
              <span className="buy-text">Buy RACKS</span>
            </button>
            <WalletButton />
            <button
              className={`menu-toggle ${menuOpen ? "open" : ""}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="mobile-menu">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/play">Play</NavLink>
            <NavLink to="/docs">Docs</NavLink>
          </nav>
        )}
      </header>

      <Outlet />

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <div className="logo">
                <img src="/rack.png" alt="RACKS" className="logo-img" />
                <span className="logo-text">RACKS</span>
              </div>
              <p>
                The last bid wins the racks. A community count-up auction for $RACKS on Robinhood
                Chain.
              </p>
              <div className="footer-social">
                <a className="footer-social-link" href={X_URL} target="_blank" rel="noreferrer" aria-label="RACKS on X">
                  <XIcon size={16} />
                </a>
                <a
                  className="footer-social-link"
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="RACKS source code on GitHub"
                >
                  <GitHubIcon size={16} />
                </a>
              </div>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <Link to="/play">Play the game</Link>
                </li>
                <li>
                  <Link to="/docs">Documentation</Link>
                </li>
                <li>
                  <a href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer">
                    Block Explorer
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4>$RACKS</h4>
              <ul>
                <li>
                  <a
                    href="https://www.ponsfamily.com/launchpad/0xe88AC3eb472f7b6fe1e8Ae4fCb53dF48A731b352"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Buy on Pons
                  </a>
                </li>
                <li>
                  <a href="https://docs.robinhood.com/chain" target="_blank" rel="noreferrer">
                    Robinhood Chain
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Audits</h4>
              <ul>
                <li>
                  <a href={ADERYN_REPORT_URL} target="_blank" rel="noreferrer">
                    Aderyn report
                  </a>
                </li>
                <li>
                  <a href={SLITHER_REPORT_URL} target="_blank" rel="noreferrer">
                    Slither report
                  </a>
                </li>
                <li>
                  <a href={AUDIT_CI_URL} target="_blank" rel="noreferrer">
                    Audit CI status
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 RACKS. For entertainment only. Not financial advice.</span>
            <span>Built on Robinhood Chain</span>
          </div>
        </div>
      </footer>
    </>
  );
}