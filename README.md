# RACKS

Count-up auction game on **Robinhood Chain**. Players bid `$RACKS` in fixed increments; every bid
resets a 180s countdown. When the clock hits zero, the top bidder takes **95%** of the pot, **2.5%**
auto-seeds the next round, **2.5%** goes to the team.

## Product

The web app is a full product site (Vite + React + wagmi + RainbowKit):

- `/#/` — landing page (hero, how it works, specs, $RACKS section)
- `/#/play` — the game (live pot, countdown, bid controls, recent racks)
- `/#/docs` — full documentation (mechanics, contract, token, security, deploy, FAQ)

Design system: dark premium Robinhood-inspired theme with the `#c8ff00` accent.

## Repo layout

```
contracts/RacksGame.sol   Game logic (count-up all-pay auction)
contracts/mocks/          MockRacks test token
test/RacksGame.js         22 test cases (Hardhat)
scripts/deploy.js         Deploy to RH testnet/mainnet
scripts/verify.js         Verify on Blockscout
scripts/export-abi.js     Push ABI into web/src/contracts
web/                      Frontend (landing + play + docs)
```

## Audit

Automated static analysis runs on every push (GitHub Actions, `.github/workflows/audit.yml`):

![Slither](https://github.com/Berageddon/racks/actions/workflows/audit.yml/badge.svg)

- **Slither** (Trail of Bits) and **Cyfrin Aderyn**: zero high/medium/low findings.
- Remaining informationals were adjudicated (false positives or by design):
  - locked-ether / reentrancy — false positives; `receive()` reverts and `settle()` is `nonReentrant` with state committed before payouts.
  - centralization — by design (`onlyOwner` controls, listed under Owner settings); the winner payout split (95 / 2.5 / 2.5) is enforced on-chain.
  - timestamp / large literals — inherent auction clock / cosmetic.
- Reports: [`audit/slither-report.md`](audit/slither-report.md) · [`audit/aderyn-report.md`](audit/aderyn-report.md)
- On the site: footer and Docs → Security link straight to the repo, both reports, and live CI status.

This is automated static analysis, not a substitute for a human audit.

## Game rules

- Pot starts seeded by the owner (owner `seed()` when no bids).
- A bid must be a **whole multiple of `tick`** (10k $RACKS) and **≥ top bid + 1 tick**.
- Each bid resets a **180s** countdown.
- Timer expiry → anyone calls `settle()` → winner gets 95%, next-round pot gets 2.5%, dev gets 2.5%.
- Next round starts auto-seeded from the reserve; no manual feeding.

## Smart contract

```bash
npm install
npx hardhat compile
npx hardhat test
```

### Deploy (testnet first)

```bash
cp .env.example .env        # fill PRIVATE_KEY and RACKS_TOKEN_ADDRESS
npm run deploy:testnet      # Robinhood Chain testnet (chainId 46630)
npm run verify:testnet
```

### Deploy to mainnet

```bash
npm run deploy:mainnet      # Robinhood Chain mainnet (chainId 4663)
npm run verify:mainnet
```

Deploy output is written to `deployed-<network>.json`.

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| RH Testnet | 46630 | `https://rpc.testnet.chain.robinhood.com` | `explorer.testnet.chain.robinhood.com` |
| RH Mainnet | 4663 | `https://rpc.mainnet.chain.robinhood.com` | `robinhoodchain.blockscout.com` |

## Frontend

```bash
cd web
cp .env.example .env        # set VITE_RACKS_GAME, VITE_RACKS_TOKEN, VITE_WALLETCONNECT_PROJECT_ID, VITE_FIREBASE_*
npm install
npm run dev                 # http://localhost:5173
```

Routes: `/#/` landing, `/#/play` game, `/#/docs` docs. The game connects to Robinhood Wallet
(RainbowKit + WalletConnect; RH Chain needs no manual network setup). Gas is paid in **ETH** on RH
Chain; users bridge ETH via the canonical Arbitrum bridge.

### Live chat (Play page)

Anonymous, name-only chat; messages expire after 20 minutes. Backed by Firebase Realtime Database
(no wallet required):

1. Create a free project at https://console.firebase.google.com → **Realtime Database** (not Firestore).
2. Project settings → Your apps → Web → copy `apiKey`, `databaseURL`, `appId` into `web/.env`
   (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_APP_ID`).
3. Set the database **Rules** to:

```json
{
  "rules": {
    ".read": true,
    "messages": {
      ".write": true,
      ".indexOn": ["ts"],
      "$key": {
        ".validate": "newData.hasChildren(['name', 'text', 'ts'])",
        "name": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 24" },
        "text": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 240" },
        "ts": { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
        "$other": { ".validate": false }
      }
    }
  }
}
```

The chat loads lazily (own JS chunk) and shows a "opens with launch" placeholder until the keys are set.

**Buy $RACKS** is everywhere (header button, hero, play page low-balance state). It opens a modal
with swap links + contract address + token stats. Real launch data goes in `web/src/token.js`
(`TOKEN_CA`, `SWAP_LINKS`, `TOKEN_STATS`) once the pons listing is live.

## Owner settings (on contract)

- `setTick(uint256)` / `setRoundTime(uint256)` / `setDevWallet(address)` / `pause()` / `unpause()`
- `seed(uint256)` top-up for a fresh round.
- `rescueTokens(address,uint256)` recovers stray tokens other than $RACKS.