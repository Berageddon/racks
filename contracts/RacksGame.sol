// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RacksGame
 * @notice Count-up all-pay auction on Robinhood Chain, played with the $RACKS token.
 * @dev The pot is seeded by the owner. Players bid in whole-TICK increments; each bid
 *      must be strictly higher than the current top bid and resets a countdown.
 *      When the countdown expires, the current top bidder wins 95% of the pot,
 *      2.5% is banked for the dev, and 2.5% auto-seeds the next round.
 *      Game rules (tick, countdown, dev wallet) are fixed at deployment and immutable.
 */
contract RacksGame is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Basis points for payout split out of 10_000.
    uint256 public constant WINNER_BPS = 9500;
    uint256 public constant DEV_BPS = 250;
    uint256 public constant RESERVE_BPS = 250;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// The $RACKS token accepted as currency.
    IERC20 public immutable racks;

    /// Wallet that permanently receives the dev share (fixed at deployment).
    address public immutable devWallet;

    /// Bid increment. Every bid must be a multiple of this and at least topBid + this.
    uint256 public immutable tick;

    /// Countdown, in seconds, reset on every bid.
    uint256 public immutable roundTime;

    // --- Current round ---
    uint256 public round;
    uint256 public potTotal;
    uint256 public topBid;
    address public topBidder;
    uint256 public roundEndsAt;

    // --- Events ---
    event Seeded(uint256 indexed round, uint256 amount, uint256 potTotal);
    event Bid(
        uint256 indexed round,
        address indexed bidder,
        uint256 amount,
        uint256 topBid,
        uint256 potTotal,
        uint256 roundEndsAt
    );
    event RoundStarted(uint256 indexed round, uint256 potTotal);
    event RoundSettled(
        uint256 indexed round,
        address indexed winner,
        uint256 potTotal,
        uint256 winnerAmount,
        uint256 devAmount,
        uint256 nextPot
    );

    // --- Errors ---
    error RoundLive(uint256 round);
    error RoundEnded();
    error RoundStillLive(uint256 round);
    error NoTopBidder();
    error BidTooLow(uint256 provided, uint256 minimum);
    error NotMultipleOfTick(uint256 amount, uint256 tick);
    error ZeroAmount();
    error InvalidToken(address token);
    error InvalidDevWallet(address devWallet);
    error TransferFailed();

    constructor(address racks_, address devWallet_) Ownable(msg.sender) {
        if (racks_ == address(0)) revert InvalidToken(racks_);
        if (devWallet_ == address(0)) revert InvalidDevWallet(devWallet_);
        racks = IERC20(racks_);
        devWallet = devWallet_;
        tick = 10_000;
        roundTime = 180;
        round = 1;
        roundEndsAt = block.timestamp + roundTime;
    }

    /// @notice Owner seeds the current (not yet started) round with the starting pot.
    function seed(uint256 amount) external nonReentrant onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (topBid != 0) revert RoundLive(round);
        uint256 received = _collect(msg.sender, amount);
        potTotal += received;
        roundEndsAt = block.timestamp + roundTime;
        emit Seeded(round, received, potTotal);
    }

    /// @notice Place a bid. Amount must be a whole multiple of `tick` and at least
    ///         the current top bid plus one `tick`. Non-refundable (all-pay).
    function bid(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount % tick != 0) revert NotMultipleOfTick(amount, tick);
        if (topBid == 0) {
            // First bid opens the round.
            if (amount < tick) revert BidTooLow(amount, tick);
        } else {
            if (block.timestamp >= roundEndsAt) revert RoundEnded();
            if (amount < topBid + tick) revert BidTooLow(amount, topBid + tick);
        }

        uint256 received = _collect(msg.sender, amount);

        topBid = amount;
        topBidder = msg.sender;
        potTotal += received;
        roundEndsAt = block.timestamp + roundTime;

        emit Bid(round, msg.sender, amount, topBid, potTotal, roundEndsAt);
    }

    /// @notice Anyone can settle once the countdown has expired. The pot is measured
    ///         from the contract's actual $RACKS balance so fee-on-transfer and
    ///         deflationary tokens can never strand or overstate the pot. Payouts:
    ///         95% winner, 2.5% dev, 2.5% auto-seeds the next round.
    function settle() external nonReentrant {
        if (topBid == 0) revert NoTopBidder();
        if (block.timestamp < roundEndsAt) revert RoundStillLive(round);

        uint256 settledRound = round;
        address winner = topBidder;

        // Measure the real pot from the token balance (tax- and donation-safe).
        uint256 pot = racks.balanceOf(address(this));

        uint256 winnerAmount = (pot * WINNER_BPS) / BPS_DENOMINATOR;
        uint256 devAmount = (pot * DEV_BPS) / BPS_DENOMINATOR;
        uint256 nextPot = pot - winnerAmount - devAmount;

        // Starting the next round (state before external calls); potTotal reconciled to reality.
        round += 1;
        potTotal = nextPot;
        topBid = 0;
        topBidder = address(0);
        roundEndsAt = block.timestamp + roundTime;
        emit RoundStarted(round, potTotal);

        // Payouts (Pull-based transfers, CEI respected).
        racks.safeTransfer(winner, winnerAmount);
        racks.safeTransfer(devWallet, devAmount);

        emit RoundSettled(settledRound, winner, pot, winnerAmount, devAmount, nextPot);
    }

    /// @notice Remaining time until the current round closes.
    function timeRemaining() external view returns (uint256) {
        return block.timestamp >= roundEndsAt ? 0 : roundEndsAt - block.timestamp;
    }

    /// @notice Interval between round close and the first bid of the next round.
    function isRoundLive() external view returns (bool) {
        return topBid != 0 && block.timestamp < roundEndsAt;
    }

    /// @notice Owner: pull funds accidentally sent to the wrong token (never the game token).
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        if (token == address(racks)) revert TransferFailed();
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function _collect(address from, uint256 amount) private returns (uint256 received) {
        uint256 before = racks.balanceOf(address(this));
        racks.safeTransferFrom(from, address(this), amount);
        received = racks.balanceOf(address(this)) - before;
        if (received == 0) revert TransferFailed();
    }

    receive() external payable {
        revert TransferFailed();
    }
}