// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RackLotto
 * @notice EuroMillions-style numbers lottery on Robinhood Chain, played with $RACKS.
 * @dev Each ticket is 5 distinct numbers from 1..30. Rounds are time-based: the
 *      round closes after ROUND_DURATION (6 h) from the first buy or seed. The
 *      owner may call drawEarly() to close a round before the timer expires. Once
 *      the timer hits zero, the next buy or claim auto-draws and advances.
 *
 *      Payout split (of each round's pot):
 *        - 70 % JACKPOT  (5/5 match)  — splits among all 5/5 winners.
 *        - 15 % TIER4    (4/5 match)  — splits among all 4/5 winners.
 *        - 10 % TIER3    (3/5 match)  — splits among all 3/5 winners.
 *        -  2.5 % DEV    — reserved per round; released to the dev wallet on the
 *                          next successful claim (forfeited shares stack first).
 *        -  2.5 % RESERVE — seeds the next round's pot.
 *
 *      A tier with zero winners does not pay: its whole pool rolls into the
 *      reserve (next round). Rounding dust from a tier with winners also rolls
 *      forward, so every wei lands in exactly one of {winners, next pot, dev}.
 *
 *      Dev is NOT paid at the draw (mirroring RacksGame): each round's share is
 *      reserved (pendingDevAmount), and when a winner claims, the dev wallet
 *      receives that round's share plus everything forfeited from lapsed claims
 *      (devAccum). Unclaimed winner shares are forfeited after CLAIM_WINDOW
 *      (1 hour) and folded into the live pot via lazy sweep. Randomness is
 *      blockhash-based (no VRF oracle exists on the chain) — audits should keep
 *      this in mind.
 */
contract RackLotto is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_NUMBER = 30;
    uint256 public constant NUMBERS_PER_TICKET = 5;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant ROUND_DURATION = 21_600; // 6 hours

    // Payout split: 7 000 / 1 500 / 1 000 / 250 / 250 = 10 000 total.
    uint256 public constant JACKPOT_BPS = 7_000;
    uint256 public constant TIER4_BPS   = 1_500;
    uint256 public constant TIER3_BPS   = 1_000;
    uint256 public constant DEV_BPS     =   250;
    uint256 public constant RESERVE_BPS =   250;

    /// Time a winner has to claim before the share is forfeited into the pot.
    uint256 public constant CLAIM_WINDOW = 3600; // 1 hour

    IERC20 public immutable racks;
    address public immutable devWallet;
    uint256 public immutable ticketPrice;

    // --- Live round ---
    uint256 public round = 1;
    uint256 public potTotal;
    uint256 public ticketsSold;
    uint256 public drawNonce;
    /// Timestamp when the current round closes. 0 = not yet open.
    uint256 public roundClosesAt;

    struct Ticket {
        address owner;
        uint256 numbers;
    }

    mapping(uint256 => Ticket) public tickets;

    // --- Per-round draw state ---
    mapping(uint256 => uint256) public winningNumbersPacked;
    mapping(uint256 => uint256) public roundPot;
    mapping(uint256 => uint256) public roundJackpotPool;
    mapping(uint256 => uint256) public roundTier4Pool;
    mapping(uint256 => uint256) public roundTier3Pool;
    mapping(uint256 => uint256) public jackpotWinnersCount;
    mapping(uint256 => uint256) public tier4WinnersCount;
    mapping(uint256 => uint256) public tier3WinnersCount;
    mapping(uint256 => uint256) public pendingAvailable;
    mapping(uint256 => uint256) public pendingDeadline;
    mapping(uint256 => uint256) public pendingDevAmount;
    mapping(uint256 => bool)    public roundSwept;
    uint256 public nextSweepRound = 1;
    /// Dev shares from forfeited claims, paid to the dev wallet on the next claim.
    uint256 public devAccum;

    mapping(uint256 => mapping(address => uint256)) public pendingClaimAmount;

    // --- Events ---
    event Seeded(uint256 indexed round, uint256 amount, uint256 potTotal);
    event TicketBought(address indexed buyer, uint256 ticketPrice, uint256 ticketsSold);
    event RoundDrawn(
        uint256 indexed round,
        uint256[5] winningNumbers,
        uint256 pot,
        uint256 jackpotPool,
        uint256 tier4Pool,
        uint256 tier3Pool,
        uint256 jackpotWinners,
        uint256 tier4Winners,
        uint256 tier3Winners,
        uint256 devAmount,
        uint256 nextPot
    );
    event WinnerClaimed(uint256 indexed round, address indexed winner, uint256 amount, uint256 devAmount);
    event RoundForfeited(uint256 indexed round, uint256 amount, uint256 devAmount);

    // --- Errors ---
    error InvalidToken(address token);
    error InvalidDevWallet(address devWallet);
    error InvalidParams();
    error ZeroAmount();
    error InvalidNumbers();
    error NumbersMustBeDistinct();
    error RoundLive(uint256 round);
    error RoundNotDrawn(uint256 settledRound);
    error NotPendingWinner();
    error ClaimExpired();
    error NoTickets();
    error TransferFailed();

    constructor(
        address racks_,
        address devWallet_,
        uint256 ticketPrice_
    ) Ownable(msg.sender) {
        if (racks_ == address(0)) revert InvalidToken(racks_);
        if (devWallet_ == address(0)) revert InvalidDevWallet(devWallet_);
        if (ticketPrice_ == 0) revert InvalidParams();
        racks = IERC20(racks_);
        devWallet = devWallet_;
        ticketPrice = ticketPrice_;
    }

    /// @notice Owner seeds the live (still empty, not yet open) round with an extra
    ///         starting pot. Starts the round timer.
    function seed(uint256 amount) external nonReentrant onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (roundClosesAt != 0) revert RoundLive(round);
        if (ticketsSold != 0) revert RoundLive(round);
        uint256 received = _collect(msg.sender, amount);
        potTotal += received;
        roundClosesAt = block.timestamp + ROUND_DURATION;
        emit Seeded(round, received, potTotal);
    }

    /// @notice Buy one or more lottery tickets. Each ticket is 5 distinct numbers in 1..30.
    /// @dev If the round timer has not started yet, this call starts it.
    ///      If the round timer has expired, the draw runs first, then tickets go into
    ///      the new round.
    function buyTickets(uint256[5][] calldata picks) external nonReentrant {
        uint256 n = picks.length;
        if (n == 0) revert ZeroAmount();

        // Reap expired unclaimed winnings into the live pot before touching funds.
        _sweepExpired();

        // If the round timer expired (or was never set for an empty round),
        // draw the current round first so tickets land in a fresh round.
        if (roundClosesAt != 0 && block.timestamp >= roundClosesAt) {
            _draw();
        }
        // A fresh round (including the one just opened by _draw) starts its
        // timer when the first ticket is placed, or when the owner seeds it.
        if (roundClosesAt == 0 && ticketsSold == 0) {
            roundClosesAt = block.timestamp + ROUND_DURATION;
        }

        uint256 received = _collect(msg.sender, ticketPrice * n);
        potTotal += received;

        for (uint256 i = 0; i < n; i++) {
            uint256 packed = _pack(picks[i]);
            tickets[ticketsSold] = Ticket(msg.sender, packed);
            ticketsSold += 1;
            emit TicketBought(msg.sender, ticketPrice, ticketsSold);
        }
    }

    /// @notice Winner-only claim for a settled round's share. The winner receives
    ///         their tier share; the dev wallet receives this round's reserved dev
    ///         plus every dev share forfeited from lapsed claims (devAccum).
    function claim(uint256 settledRound) external nonReentrant {
        if (settledRound >= round) revert RoundNotDrawn(settledRound);
        _sweepExpired();
        if (block.timestamp > pendingDeadline[settledRound]) revert ClaimExpired();

        uint256 amount = pendingClaimAmount[settledRound][msg.sender];
        if (amount == 0) revert NotPendingWinner();

        // Reserved (pull-based) payouts. CEI respected.
        pendingClaimAmount[settledRound][msg.sender] = 0;
        pendingAvailable[settledRound] -= amount;

        uint256 roundDevAmount = pendingDevAmount[settledRound];
        uint256 devPayout = roundDevAmount + devAccum;
        devAccum = 0;
        delete pendingDevAmount[settledRound];
        // NOTE: pendingDeadline is deliberately NOT cleared here — a round can have
        // many winners, and later claims must still pass the window check. It is
        // cleared only by the sweep once the whole round is forfeited.

        racks.safeTransfer(msg.sender, amount);
        racks.safeTransfer(devWallet, devPayout);
        emit WinnerClaimed(settledRound, msg.sender, amount, devPayout);
    }

    /// @notice Owner override: draw a round before the timer expires.
    ///         Requires at least one ticket.
    function drawEarly() external nonReentrant onlyOwner {
        if (ticketsSold == 0) revert NoTickets();
        _draw();
    }

    // --- Internal draw ---

    function _draw() internal {
        uint256 settledRound = round;
        uint256 pot = potTotal;
        roundPot[settledRound] = pot;

        // Split pools before touching state.
        uint256 jackpotPool = (pot * JACKPOT_BPS) / BPS_DENOMINATOR;
        uint256 tier4Pool   = (pot * TIER4_BPS)   / BPS_DENOMINATOR;
        uint256 tier3Pool   = (pot * TIER3_BPS)   / BPS_DENOMINATOR;
        uint256 devAmount   = (pot * DEV_BPS)     / BPS_DENOMINATOR;
        // Start from the exact reserve seed; tier pools roll back in as they empty.
        uint256 nextPot = pot - jackpotPool - tier4Pool - tier3Pool - devAmount;

        roundJackpotPool[settledRound] = jackpotPool;
        roundTier4Pool[settledRound]   = tier4Pool;
        roundTier3Pool[settledRound]   = tier3Pool;

        uint256 k5;
        uint256 k4;
        uint256 k3;

        if (ticketsSold > 0) {
            uint256 winningPacked = _drawWinningNumbers();
            winningNumbersPacked[settledRound] = winningPacked;

            for (uint256 i = 0; i < ticketsSold; i++) {
                uint256 m = _matchCount(tickets[i].numbers, winningPacked);
                if (m == 5) k5 += 1;
                else if (m == 4) k4 += 1;
                else if (m == 3) k3 += 1;
            }

            uint256 acc;
            (acc, nextPot) = _payTier(settledRound, winningPacked, 5, jackpotPool, k5, 0, nextPot);
            (acc, nextPot) = _payTier(settledRound, winningPacked, 4, tier4Pool, k4, acc, nextPot);
            (acc, nextPot) = _payTier(settledRound, winningPacked, 3, tier3Pool, k3, acc, nextPot);
            pendingAvailable[settledRound] = acc;
        } else {
            // Empty expired round: every tier has zero winners, so the whole pot
            // (minus the dev share) rolls forward.
            nextPot += jackpotPool + tier4Pool + tier3Pool;
        }
        pendingDeadline[settledRound] = block.timestamp + CLAIM_WINDOW;

        jackpotWinnersCount[settledRound] = k5;
        tier4WinnersCount[settledRound]   = k4;
        tier3WinnersCount[settledRound]   = k3;

        // The dev share stays reserved until a claim releases it — or the sweep
        // folds it into devAccum (paid on the next successful claim).
        pendingDevAmount[settledRound] = devAmount;

        // Open the next round (state committed before any external interaction).
        round += 1;
        potTotal = nextPot;
        ticketsSold = 0;
        drawNonce += 1;
        roundClosesAt = 0; // next round not yet open

        _emitDrawn(settledRound);
    }

    function _emitDrawn(uint256 settledRound) internal {
        emit RoundDrawn(
            settledRound,
            _unpack(winningNumbersPacked[settledRound]),
            roundPot[settledRound],
            roundJackpotPool[settledRound],
            roundTier4Pool[settledRound],
            roundTier3Pool[settledRound],
            jackpotWinnersCount[settledRound],
            tier4WinnersCount[settledRound],
            tier3WinnersCount[settledRound],
            pendingDevAmount[settledRound],
            potTotal
        );
    }

    function _payTier(
        uint256 settledRound,
        uint256 winningPacked,
        uint256 tier,
        uint256 pool,
        uint256 k,
        uint256 running,
        uint256 nextPot
    ) internal returns (uint256 accrued, uint256 updatedNextPot) {
        if (k == 0) {
            return (running, nextPot + pool); // whole pool rolls over
        }
        uint256 share = pool / k;
        for (uint256 i = 0; i < ticketsSold; i++) {
            if (_matchCount(tickets[i].numbers, winningPacked) != tier) continue;
            pendingClaimAmount[settledRound][tickets[i].owner] += share;
        }
        uint256 added = share * k;
        accrued = running + added;
        updatedNextPot = nextPot + (pool - added); // dust rolls over
    }

    function _sweepExpired() internal {
        while (nextSweepRound < round) {
            uint256 r = nextSweepRound;
            uint256 deadline = pendingDeadline[r];
            if (deadline == 0) {
                // Slot cleared (claim paid) or never existed.
                nextSweepRound = r + 1;
            } else if (block.timestamp > deadline) {
                uint256 unclaimed = pendingAvailable[r];
                uint256 roundDevAmount = pendingDevAmount[r];
                if (unclaimed > 0) potTotal += unclaimed;
                if (roundDevAmount > 0) devAccum += roundDevAmount;
                roundSwept[r] = true;
                emit RoundForfeited(r, unclaimed, roundDevAmount);
                delete pendingAvailable[r];
                delete pendingDevAmount[r];
                delete pendingDeadline[r];
                nextSweepRound = r + 1;
            } else {
                // First still-live claim — stop here.
                break;
            }
        }
    }

    // --- Views ---

    function timeRemaining() external view returns (uint256) {
        if (roundClosesAt == 0 || block.timestamp >= roundClosesAt) return 0;
        return roundClosesAt - block.timestamp;
    }

    function winningNumbers(uint256 settledRound) external view returns (uint256[5] memory) {
        return _unpack(winningNumbersPacked[settledRound]);
    }

    function pendingClaimOf(address who) external view returns (uint256 round_, uint256 amount, uint256 deadline, bool hasClaim) {
        for (uint256 r = nextSweepRound; r < round; r++) {
            uint256 amt = pendingClaimAmount[r][who];
            if (amt != 0 && pendingDeadline[r] != 0 && block.timestamp <= pendingDeadline[r]) {
                return (r, amt, pendingDeadline[r], true);
            }
        }
        return (0, 0, 0, false);
    }

    function rescueTokens(address token) external onlyOwner {
        if (token == address(racks)) revert TransferFailed();
        IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }

    // --- Internals: numbers ---

    function _pack(uint256[5] memory src) internal pure returns (uint256 packed) {
        uint8[5] memory nums = [uint8(0), uint8(0), uint8(0), uint8(0), uint8(0)];
        for (uint256 i = 0; i < 5; i++) {
            uint256 v = src[i];
            if (v < 1 || v > MAX_NUMBER) revert InvalidNumbers();
            for (uint256 j = 0; j < i; j++) {
                if (src[j] == v) revert NumbersMustBeDistinct();
            }
            nums[i] = uint8(v);
        }
        for (uint256 i = 1; i < 5; i++) {
            uint8 key = nums[i];
            uint256 j = i;
            while (j > 0 && nums[j - 1] > key) {
                nums[j] = nums[j - 1];
                j--;
            }
            nums[j] = key;
        }
        for (uint256 i = 0; i < 5; i++) {
            packed |= uint256(nums[i]) << (i * 5);
        }
    }

    function _unpack(uint256 packed) internal pure returns (uint256[5] memory out) {
        for (uint256 i = 0; i < 5; i++) {
            out[i] = (packed >> (i * 5)) & 0x1f;
        }
    }

    function _matchCount(uint256 ticketPacked, uint256 winningPacked) internal pure returns (uint256) {
        uint256 i;
        uint256 j;
        uint256 count;
        while (i < 5 && j < 5) {
            uint256 a = (ticketPacked >> (i * 5)) & 0x1f;
            uint256 b = (winningPacked >> (j * 5)) & 0x1f;
            if (a < b) i += 1;
            else if (a > b) j += 1;
            else {
                count += 1;
                i += 1;
                j += 1;
            }
        }
        return count;
    }

    function _drawWinningNumbers() internal returns (uint256 packed) {
        uint256 seed = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, round, drawNonce))
        );
        uint8[5] memory picks;
        uint256 len;
        uint256 counter;
        while (len < 5) {
            uint256 candidate = (uint256(keccak256(abi.encodePacked(seed, counter))) % MAX_NUMBER) + 1;
            counter += 1;
            bool dup;
            for (uint256 j = 0; j < len; j++) {
                if (picks[j] == candidate) dup = true;
            }
            if (dup) continue;
            picks[len] = uint8(candidate);
            len += 1;
        }
        for (uint256 i = 1; i < 5; i++) {
            uint8 key = picks[i];
            uint256 j = i;
            while (j > 0 && picks[j - 1] > key) {
                picks[j] = picks[j - 1];
                j--;
            }
            picks[j] = key;
        }
        for (uint256 i = 0; i < 5; i++) {
            packed |= uint256(picks[i]) << (i * 5);
        }
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
