# Slither Analysis Report

This report was generated with [Slither](https://github.com/crytic/slither) v0.11.6 (Trail of
Bits), a static analysis framework for Solidity. It complements the [Aderyn report](./aderyn-report.md);
together they form the automated static-analysis layer of the project's audit trail.

- Scope: `contracts/RacksGame.sol` (+ imported OpenZeppelin libraries in `node_modules/`)
- Command: `slither . --filter-paths mocks`
- Companion: 22 behavioral tests in `test/RacksGame.js` (Hardhat)

## Summary

| Severity | Count | On RacksGame.sol |
| --- | --- | --- |
| High | 0 | 0 |
| Medium | 0 | 0 |
| Low | 0 | 0 |
| Informational | 24 | 3 |
| **Total** | **24** | **3** |

All 24 informational results were reviewed. 21 concern OpenZeppelin dependency code only
(pragma version ranges, `StorageSlot` assembly, non-indexed OZ events) and require no action.
The 3 results that touch the game contract are analyzed individually below.

## Findings on RacksGame.sol

### I-1 — Dangerous strict equality: `received == 0`

- Location: `_collect` (contracts/RacksGame.sol)
- Adjudication: **False positive / intentional.** The guard rejects dust outright when a
  fee-on-transfer or deflationary token delivers zero real value. It is an input-acceptance
  check, not a balance-based decision; a fee-on-transfer token that delivers 1 wei is still
  accepted and the pot is measured top-down from `balanceOf` at settlement.

### I-2 — Contract locks Ether without a withdraw function

- Location: `receive()` (contracts/RacksGame.sol)
- Adjudication: **False positive / intentional.** `receive()` is payable but immediately
  reverts, so stray native transfers fail loudly and no ETH can ever be trapped. No other
  payable function exists.

### I-3 — Use of `block.timestamp` for comparisons

- Location: `bid`, `settle`, `timeRemaining`, `isRoundLive`
- Adjudication: **Inherent to the game design.** The 180-second countdown is also the auction
  clock; validator-level timestamp manipulation by at most a few seconds only shifts the
  deadline and cannot mint, steal, or mispay funds (all bids are all-pay and the split is
  integer-exact). This is the standard trade-off for time-based auction games.

## Conclusion

Static analysis found **no high, medium, or low severity issues**. The three informational
findings touching the first-party contract are either intentional design decisions or
inherent to a countdown auction. Verification is backed by 22 passing behavioral tests that
exercise the full game loop, including fee-on-transfer and multi-round settlement.

*Automated scanning is not a substitute for a professional human audit. Review the open-source
contract yourself: <https://github.com/Berageddon/racks>*