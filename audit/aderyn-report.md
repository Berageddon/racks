# Aderyn Analysis Report

Automated static analysis of **`contracts/RacksGame.sol`**, generated with
[Aderyn](https://github.com/Cyfrin/aderyn) **v0.6.8** (Cyfrin) on 2026-09-11
(CI run 34632999332).

> **Verdict: no exploitable findings.** The scanner reported 4 items (2 High + 2 Low).
> After review, both High items are **false positives**, L-1 is a **by-design**
> centralization note, and L-2 is **cosmetic**. Each finding is adjudicated below,
> and the unmodified tool output is reproduced at the end for full transparency.

This is automated scanning, **not a substitute for a professional human audit.** The
open-source contract remains freely reviewable:
https://github.com/Berageddon/racks

## Scope & run info

| Item | Value |
| --- | --- |
| Tool | Aderyn v0.6.8 (Cyfrin) |
| Target | `contracts/RacksGame.sol` (148 nSLOC) |
| Excluded | `contracts/mocks/` |
| Companion tests | 22 behavioral tests in `test/RacksGame.js` (Hardhat) |
| Related report | [`slither-report.md`](slither-report.md) |

## Summary

| Severity | Raw count | Adjudication |
| --- | --- | --- |
| High | 2 | 0 — both false positives |
| Medium | 0 | — |
| Low | 2 | 1 by design · 1 cosmetic |

## Adjudication

### H-1 — Contract locks Ether without a withdraw function — FALSE POSITIVE

`receive()` is `payable` solely so that stray native payments **fail loudly** — it
immediately executes `revert TransferFailed()`. No other payable path exists, and
there is no way for the contract to accept or hold ETH. Ether cannot be trapped
because the only receive path reverts at the EVM level.

### H-2 — Reentrancy: state change after external call — FALSE POSITIVE

The flagged "external call" is `racks.balanceOf(address(this))` — a **read-only**
view call used to measure the pot. The settle path:

1. is guarded by `nonReentrant` (OpenZeppelin `ReentrancyGuard`);
2. updates all state (`round`, `potTotal`, `topBid`, `topBidder`, `roundEndsAt`)
   **before** any value-moving call (checks-effects-interactions);
3. only then performs the payout `safeTransfer`s.

The heuristic flags *any* external call followed by a state write, but the actual
execution order plus the reentrancy guard make re-entry impossible.

### L-1 — Centralization risk — BY DESIGN (documented)

The owner can configure the tick, countdown, dev wallet, pause/unpause, seed
rounds, and rescue stray tokens (OpenZeppelin `Ownable`). This is disclosed in the
project docs. Constraints that limit the risk:

- the owner **cannot mint or drain the game token** — `rescueTokens` refuses `racks`;
- the 95 / 2.5 / 2.5 payout split is enforced on-chain and can't be changed;
- the timer and payout (`settle`) are **permissionless** — anyone can settle.

### L-2 — Large numeric literals — COSMETIC

`10_000` / `tick = 10_000` could be written `1e4`; readability-only, zero security
impact.

---

## Raw tool output (unmodified)

# Table of Contents

- [Summary](#summary)
  - [Files Summary](#files-summary)
  - [Files Details](#files-details)
  - [Issue Summary](#issue-summary)
- [High Issues](#high-issues)
  - [H-1: Contract locks Ether without a withdraw function](#h-1-contract-locks-ether-without-a-withdraw-function)
  - [H-2: Reentrancy: State change after external call](#h-2-reentrancy-state-change-after-external-call)
- [Low Issues](#low-issues)
  - [L-1: Centralization Risk](#l-1-centralization-risk)
  - [L-2: Large Numeric Literal](#l-2-large-numeric-literal)


# Summary

## Files Summary

| Key | Value |
| --- | --- |
| .sol Files | 1 |
| Total nSLOC | 148 |


## Files Details

| Filepath | nSLOC |
| --- | --- |
| contracts/RacksGame.sol | 148 |
| **Total** | **148** |


## Issue Summary

| Category | No. of Issues |
| --- | --- |
| High | 2 |
| Low | 2 |


# High Issues

## H-1: Contract locks Ether without a withdraw function

It appears that the contract includes a payable function to accept Ether but lacks a corresponding function to withdraw it, which leads to the Ether being locked in the contract. To resolve this issue, please implement a public or external function that allows for the withdrawal of Ether from the contract.

<details><summary>1 Found Instances</summary>


- Found in contracts/RacksGame.sol [Line: 18](contracts/RacksGame.sol#L18)

	```solidity
	contract RacksGame is Ownable, Pausable, ReentrancyGuard {
	```

</details>



## H-2: Reentrancy: State change after external call

Changing state after an external call can lead to re-entrancy attacks.Use the checks-effects-interactions pattern to avoid this issue.

<details><summary>1 Found Instances</summary>


- Found in contracts/RacksGame.sol [Line: 139](contracts/RacksGame.sol#L139)

	State is changed at: `round += 1`, `potTotal = nextPot`, `topBid = 0`, `topBidder = address(0)`, `roundEndsAt = block.timestamp + roundTime`
	```solidity
	        uint256 pot = racks.balanceOf(address(this));
	```

</details>



# Low Issues

## L-1: Centralization Risk

Contracts have owners with privileged rights to perform admin tasks and need to be trusted to not perform malicious updates or drain funds.

<details><summary>8 Found Instances</summary>


- Found in contracts/RacksGame.sol [Line: 18](contracts/RacksGame.sol#L18)

	```solidity
	contract RacksGame is Ownable, Pausable, ReentrancyGuard {
	```

- Found in contracts/RacksGame.sol [Line: 95](contracts/RacksGame.sol#L95)

	```solidity
	    function seed(uint256 amount) external nonReentrant onlyOwner whenNotPaused {
	```

- Found in contracts/RacksGame.sol [Line: 171](contracts/RacksGame.sol#L171)

	```solidity
	    function rescueTokens(address token, uint256 amount) external onlyOwner {
	```

- Found in contracts/RacksGame.sol [Line: 178](contracts/RacksGame.sol#L178)

	```solidity
	    function setTick(uint256 tick_) external onlyOwner {
	```

- Found in contracts/RacksGame.sol [Line: 184](contracts/RacksGame.sol#L184)

	```solidity
	    function setRoundTime(uint256 roundTime_) external onlyOwner {
	```

- Found in contracts/RacksGame.sol [Line: 190](contracts/RacksGame.sol#L190)

	```solidity
	    function setDevWallet(address devWallet_) external onlyOwner {
	```

- Found in contracts/RacksGame.sol [Line: 197](contracts/RacksGame.sol#L197)

	```solidity
	    function pause() external onlyOwner {
	```

- Found in contracts/RacksGame.sol [Line: 202](contracts/RacksGame.sol#L202)

	```solidity
	    function unpause() external onlyOwner {
	```

</details>



## L-2: Large Numeric Literal

Large literal values multiples of 10000 can be replaced with scientific notation.Use `e` notation, for example: `1e18`, instead of its full numeric value.

<details><summary>2 Found Instances</summary>


- Found in contracts/RacksGame.sol [Line: 25](contracts/RacksGame.sol#L25)

	```solidity
	    uint256 public constant BPS_DENOMINATOR = 10_000;
	```

- Found in contracts/RacksGame.sol [Line: 88](contracts/RacksGame.sol#L88)

	```solidity
	        tick = 10_000;
	```

</details>