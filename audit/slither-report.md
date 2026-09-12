# Slither Analysis Report

This report was generated with [Slither](https://github.com/crytic/slither) v0.11.6 (Trail of
Bits), a static analysis framework for Solidity. It complements the [Aderyn report](./aderyn-report.md);
together they form the automated static-analysis layer of the project's audit trail.

- Scope: `contracts/RacksGame.sol` (+ imported OpenZeppelin libraries in `node_modules/`)
- Command: `slither . --filter-paths mocks`
- Companion: 24 behavioral tests in `test/RacksGame.js` (Hardhat)
- Re-run: against the final contract (immutable rules — tick / countdown / dev wallet fixed at
  deployment, no pause, no admin setters, claim + auto-advance model)

## Summary

| Severity | Count | On RacksGame.sol |
| --- | --- | --- |
| High | 0 | 0 |
| Medium | 0 | 0 |
| Low | 0 | 0 |
| Informational | 24 | 8 |
| **Total** | **24** | **8** |

All 24 informational results were reviewed. 16 concern OpenZeppelin dependency code only
(pragma version ranges, `StorageSlot`/`SafeERC20` assembly) and require no action. The 8 results
that touch the game contract are 3 distinct detectors — `incorrect-equality` (1), `locked-ether`
(1), and `timestamp` (6, one per time-based path, including the claim and forfeiture sweeps).
The owned-function surface remains exactly two (`seed`, `rescueTokens`).

## Findings on RacksGame.sol

### I-1 — Dangerous strict equality: `received == 0`

- Location: `_collect` (contracts/RacksGame.sol#304-309)
- Adjudication: **False positive / intentional.** The guard rejects dust outright when a
  fee-on-transfer or deflationary token delivers zero real value. It is an input-acceptance
  check, not a balance-based decision; a fee-on-transfer token that delivers 1 wei is still
  accepted. The pot is measured from the tokens actually received, and winner/dev payouts are
  reserved per round at the bell and paid out on claim.

### I-2 — Contract locks Ether without a withdraw function

- Location: `receive()` (contracts/RacksGame.sol#311-313)
- Adjudication: **False positive / intentional.** `receive()` is payable but immediately
  reverts, so stray native transfers fail loudly and no ETH can ever be trapped. No other
  payable function exists.

### I-3 — Use of `block.timestamp` for comparisons

- Location: `bid` (RacksGame.sol#128), `claim` (#159), `_sweepExpired` (#223), `isRoundExpired`
  (#249), `timeRemaining` (#278), `isRoundLive` (#284)
- Adjudication: **Inherent to the game design.** The 180-second countdown, the 1-hour claim
  window, and the forfeiture sweeps are the auction clocks; validator-level timestamp
  manipulation by at most a few seconds only shifts the bell by that much and cannot mint,
  steal, or mispay funds (all bids are all-pay and every split is integer-exact). This is the
  standard trade-off for time-based auction games.

## Conclusion

Static analysis found **no high, medium, or low severity issues**. The eight informational
findings touching the first-party contract are either intentional design decisions or
inherent to a countdown auction. Verification is backed by 24 passing behavioral tests that
exercise the full game loop, including fee-on-transfer, multi-round auto-advance, winner
claims within the 1-hour window, and forfeiture sweeps, against a contract whose owner
surface is minimal and whose game rules are immutable.

*Automated scanning is not a substitute for a professional human audit. Review the open-source
contract yourself: <https://github.com/Berageddon/racks>*