// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RacksGame
 * @notice Count-up all-pay auction on Robinhood Chain, played with the $RACKS token.
 * @dev The game is time-driven: when a round's countdown expires the round is over and the
 *      next round is live immediately (seeded from the 2.5% reserve) — no claim is needed
 *      to advance the game. The winner's 95% and the dev's 2.5% are reserved per round and
 *      paid out only when that round's winner claims within CLAIM_WINDOW. If the winner never
 *      claims, their 95% rolls into the upcoming round's pot and the dev's 2.5% accumulates
 *      separately (paid to the dev wallet on the next successful claim).
 *      Game rules (tick, countdown, dev wallet) are fixed at deployment and immutable.
 */
contract RacksGame is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Basis points for payout split out of 10_000.
    uint256 public constant WINNER_BPS = 9500;
    uint256 public constant DEV_BPS = 250;
    uint256 public constant RESERVE_BPS = 250;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// Time a round winner has to claim their payout before it is forfeited.
    uint256 public constant CLAIM_WINDOW = 3600;

    /// The $RACKS token accepted as currency.
    IERC20 public immutable racks;

    /// Wallet that receives the dev share (fixed at deployment).
    address public immutable devWallet;

    /// Bid increment. Every bid must be a multiple of this and at least topBid + this.
    uint256 public immutable tick;

    /// Countdown, in seconds, reset on every bid.
    uint256 public immutable roundTime;

    // --- Last physically stored round ---
    uint256 public round;
    uint256 public potTotal;
    uint256 public topBid;
    address public topBidder;
    uint256 public roundEndsAt;

    // --- Per-round pending winner claims ---
    mapping(uint256 => address) public pendingWinner;
    mapping(uint256 => uint256) public pendingWinnerAmount;
    mapping(uint256 => uint256) public pendingDevAmount;
    mapping(uint256 => uint256) public pendingDeadline;
    /// Oldest round that still holds a pending claim (sweep cursor).
    uint256 public nextPendingRound;
    /// Forfeited winner shares waiting to seed the upcoming round's pot.
    uint256 public futureSeed;
    /// Dev shares from forfeited rounds, paid to the dev wallet on the next claim.
    uint256 public devAccum;

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
    event WinnerClaimed(
        uint256 indexed round,
        address indexed winner,
        uint256 winnerAmount,
        uint256 devAmount
    );
    event WinnerForfeited(uint256 indexed round, uint256 winnerAmount, uint256 devAmount);

    // --- Errors ---
    error RoundLive(uint256 round);
    error BidTooLow(uint256 provided, uint256 minimum);
    error NotMultipleOfTick(uint256 amount, uint256 tick);
    error ZeroAmount();
    error InvalidToken(address token);
    error InvalidDevWallet(address devWallet);
    error NotPendingWinner();
    error ClaimExpired();
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
        nextPendingRound = 1;
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

    /// @notice Place a bid. Amount must be a whole multiple of `tick`.
    /// @dev If the stored round has already expired, this bid first opens the next round
    ///      (auto-seeded from the reserve, plus any forfeited shares), then lands in it as
    ///      the first bid — which is what starts the new round's countdown. No funds move
    ///      during that transition; money only moves when a winner claims.
    function bid(uint256 amount) external nonReentrant {
        // Process any matured forfeitures before the bid so the treasury and
        // next-round reserves stay current.
        _sweepExpired();
        if (amount == 0) revert ZeroAmount();
        if (amount % tick != 0) revert NotMultipleOfTick(amount, tick);
        if (topBid == 0) {
            // First bid opens the round.
            if (amount < tick) revert BidTooLow(amount, tick);
        } else if (block.timestamp >= roundEndsAt) {
            // Stored round is over: open the next round, then place this bid in it.
            _openNextRound();
            if (amount < tick) revert BidTooLow(amount, tick);
        } else {
            if (amount < topBid + tick) revert BidTooLow(amount, topBid + tick);
        }

        uint256 received = _collect(msg.sender, amount);

        topBid = amount;
        topBidder = msg.sender;
        potTotal += received;
        roundEndsAt = block.timestamp + roundTime;

        emit Bid(round, msg.sender, amount, topBid, potTotal, roundEndsAt);
    }

    /// @notice Winner-only claim for the payout of a settled round. If that round is still
    ///         the stored, ended round, claiming also opens the next round. In this one
    ///         transaction the winner receives 95%, the dev wallet receives that round's
    ///         2.5% plus everything accumulated from previous forfeited rounds.
    function claim(uint256 settledRound) external nonReentrant {
        // Reap any expired claims before resolving this round.
        _sweepExpired();

        // If the claimed round is still the stored, ended round, open the next one.
        if (settledRound == round && topBid != 0 && block.timestamp >= roundEndsAt) {
            _openNextRound();
        }

        if (pendingWinner[settledRound] != msg.sender) revert NotPendingWinner();
        if (block.timestamp > pendingDeadline[settledRound]) revert ClaimExpired();

        // Reserved (pull-based) payouts. CEI respected.
        uint256 winnerAmount = pendingWinnerAmount[settledRound];
        uint256 roundDevAmount = pendingDevAmount[settledRound];
        uint256 devPayout = roundDevAmount + devAccum;
        devAccum = 0;

        delete pendingWinner[settledRound];
        delete pendingWinnerAmount[settledRound];
        delete pendingDevAmount[settledRound];
        delete pendingDeadline[settledRound];

        racks.safeTransfer(msg.sender, winnerAmount);
        racks.safeTransfer(devWallet, devPayout);

        emit WinnerClaimed(settledRound, msg.sender, winnerAmount, devPayout);
    }

    /// @notice Advance the stored round: reserve the 95/2.5 winner+dev shares of the ended
    ///         round as a claim, and start the next round seeded from the 2.5% reserve plus
    ///         any forfeited shares. Money does not move here — only when the winner claims.
    function _openNextRound() internal {
        // Preconditions enforced by callers: topBid != 0 && block.timestamp >= roundEndsAt.
        _sweepExpired();

        uint256 settledRound = round;
        uint256 pot = potTotal;

        uint256 winnerAmount = (pot * WINNER_BPS) / BPS_DENOMINATOR;
        uint256 roundDevAmount = (pot * DEV_BPS) / BPS_DENOMINATOR;
        uint256 nextPot = pot - winnerAmount - roundDevAmount + futureSeed;
        futureSeed = 0;

        // Reserve the claim for this round's winner. The window runs from the bell.
        pendingWinner[settledRound] = topBidder;
        pendingWinnerAmount[settledRound] = winnerAmount;
        pendingDevAmount[settledRound] = roundDevAmount;
        pendingDeadline[settledRound] = roundEndsAt + CLAIM_WINDOW;

        // Start the next round (state committed before any external interaction).
        round += 1;
        potTotal = nextPot;
        topBid = 0;
        topBidder = address(0);
        roundEndsAt = block.timestamp + roundTime;

        emit RoundSettled(settledRound, pendingWinner[settledRound], pot, winnerAmount, roundDevAmount, nextPot);
        emit RoundStarted(round, potTotal);
    }

    /// @notice Forfeit any pending claims whose window has closed. The winner's 95% joins
    ///         `futureSeed` (to seed the upcoming round) and the dev's 2.5% joins `devAccum`
    ///         (kept separately, paid to the dev wallet on the next successful claim).
    function _sweepExpired() internal {
        while (nextPendingRound < round) {
            uint256 r = nextPendingRound;
            uint256 deadline = pendingDeadline[r];
            if (deadline == 0) {
                // Slot cleared or never existed.
                nextPendingRound = r + 1;
            } else if (block.timestamp > deadline) {
                uint256 winnerAmount = pendingWinnerAmount[r];
                uint256 roundDevAmount = pendingDevAmount[r];
                futureSeed += winnerAmount;
                devAccum += roundDevAmount;
                emit WinnerForfeited(r, winnerAmount, roundDevAmount);
                delete pendingWinner[r];
                delete pendingWinnerAmount[r];
                delete pendingDevAmount[r];
                delete pendingDeadline[r];
                nextPendingRound = r + 1;
            } else {
                // First still-live claim — stop here.
                break;
            }
        }
    }

    /// @notice True once the stored round's countdown has expired (and someone holds a top bid).
    function isRoundExpired() public view returns (bool) {
        return topBid != 0 && block.timestamp >= roundEndsAt;
    }

    // --- Views of the live game state (auto-advance on expiry) ---

    /// @notice The round currently playing. Advances by one the moment the previous bell rings.
    function effectiveRound() external view returns (uint256) {
        return isRoundExpired() ? round + 1 : round;
    }

    /// @notice The pot of the live round (auto-seeded from the reserve on expiry).
    function effectivePotTotal() external view returns (uint256) {
        if (!isRoundExpired()) return potTotal;
        return (potTotal * RESERVE_BPS) / BPS_DENOMINATOR + futureSeed;
    }

    /// @notice The current top bid of the live round (none while awaiting its first bid).
    function effectiveTopBid() external view returns (uint256) {
        return isRoundExpired() ? 0 : topBid;
    }

    /// @notice The current top bidder of the live round (none while awaiting its first bid).
    function effectiveTopBidder() external view returns (address) {
        return isRoundExpired() ? address(0) : topBidder;
    }

    /// @notice Remaining time until the current round closes. While the round awaits its
    ///         first bid the timer has not started, so the full round time is shown.
    function timeRemaining() external view returns (uint256) {
        if (topBid == 0) return roundTime; // first bid starts the countdown
        return block.timestamp >= roundEndsAt ? 0 : roundEndsAt - block.timestamp;
    }

    /// @notice True while at least one bid is in and the countdown is still running.
    function isRoundLive() external view returns (bool) {
        return topBid != 0 && block.timestamp < roundEndsAt;
    }

    /// @notice Any claim currently reserved for `who` (winner of whichever round).
    function pendingClaimOf(address who) external view returns (uint256 round_, uint256 amount, uint256 deadline, bool hasClaim) {
        for (uint256 r = nextPendingRound; r <= round; r++) {
            if (pendingWinner[r] == who) {
                return (r, pendingWinnerAmount[r], pendingDeadline[r], true);
            }
        }
        return (0, 0, 0, false);
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