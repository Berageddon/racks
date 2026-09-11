import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            className="wallet-wrap"
            {...(!ready && { "aria-hidden": true, style: { opacity: 0, pointerEvents: "none", userSelect: "none" } })}
          >
            {!connected ? (
              <button className="wallet-btn wallet-connect" type="button" onClick={openConnectModal}>
                Connect wallet
              </button>
            ) : chain.unsupported ? (
              <button className="wallet-btn wallet-switch" type="button" onClick={openChainModal}>
                <span className="wallet-x" />
                Switch network
              </button>
            ) : (
              <button className="wallet-btn wallet-account" type="button" onClick={openAccountModal}>
                <span className="wallet-dot" />
                <span className="wallet-addr">{account.displayName}</span>
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}