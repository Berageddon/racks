import { Link, NavLink, Outlet } from "react-router-dom";
import WalletButton from "./WalletButton";
import { useBuy } from "./BuyModal";

export default function Layout() {
  const { openBuy } = useBuy();

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
              <span className="buy-word">Buy</span> RACKS
            </button>
            <WalletButton />
          </div>
        </div>
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
                  <a href="https://ponsfamily.com/launchpad" target="_blank" rel="noreferrer">
                    Launched on Pons
                  </a>
                </li>
                <li>
                  <a href="https://docs.robinhood.com/chain" target="_blank" rel="noreferrer">
                    Robinhood Chain
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