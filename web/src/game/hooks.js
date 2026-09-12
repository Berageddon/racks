import { useChainId, useReadContract, usePublicClient, useAccount } from "wagmi";
import { useEffect, useState } from "react";
import { parseAbiItem } from "viem";
import { robinhoodChain, robinhoodChainTestnet, GAME_ADDRESS, TOKEN_ADDRESS } from "../config";
import RacksGameABI from "../contracts/RacksGameABI.json";
import { erc20Abi } from "../contracts/erc20Abi";

export function useGameData() {
  const chainId = useChainId();
  const target = chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain;
  const { address } = useAccount();

  const common = { address: GAME_ADDRESS, abi: RacksGameABI, chainId: target.id };
  // Poll every 5s so the game state (pot, top bid, clock) tracks the chain live.
  const commonQuery = { enabled: !!GAME_ADDRESS, refetchInterval: 5000 };

  // The game auto-advances the moment a round's countdown expires, so we read the
  // derived "effective" views that reflect the live round without needing a tx.
  const round = useReadContract({ ...common, functionName: "effectiveRound", query: commonQuery });
  const potTotal = useReadContract({ ...common, functionName: "effectivePotTotal", query: commonQuery });
  const topBid = useReadContract({ ...common, functionName: "effectiveTopBid", query: commonQuery });
  const topBidder = useReadContract({ ...common, functionName: "effectiveTopBidder", query: commonQuery });
  const tick = useReadContract({ ...common, functionName: "tick", query: commonQuery });
  const roundTime = useReadContract({ ...common, functionName: "roundTime", query: commonQuery });
  const devWallet = useReadContract({ ...common, functionName: "devWallet", query: commonQuery });
  const timeRemaining = useReadContract({ ...common, functionName: "timeRemaining", query: commonQuery });

  // A reserved payout for the connected wallet if it won a settled round.
  const pendingClaimOf = useReadContract({
    ...common,
    functionName: "pendingClaimOf",
    args: address ? [address] : undefined,
    query: { enabled: !!GAME_ADDRESS && !!address, refetchInterval: 5000 },
  });
  const rawClaim = pendingClaimOf.data;
  const pendingClaim =
    rawClaim && rawClaim[3]
      ? { round: rawClaim[0], amount: rawClaim[1], deadline: rawClaim[2] }
      : null;

  const tokenCommon = { address: TOKEN_ADDRESS, abi: erc20Abi, chainId: target.id };
  const balance = useReadContract({
    ...tokenCommon,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!TOKEN_ADDRESS },
  });
  const allowance = useReadContract({
    ...tokenCommon,
    functionName: "allowance",
    args: address ? [address, GAME_ADDRESS] : undefined,
    query: { enabled: !!address && !!GAME_ADDRESS && !!TOKEN_ADDRESS },
  });

  return {
    target,
    isOnTargetChain: chainId === target.id,
    isOnTestnet: chainId === robinhoodChainTestnet.id,
    connectionOk: chainId === robinhoodChain.id || chainId === robinhoodChainTestnet.id,
    round: round.data,
    potTotal: potTotal.data,
    topBid: topBid.data,
    topBidder: topBidder.data,
    tick: tick.data,
    roundTime: roundTime.data,
    devWallet: devWallet.data,
    timeRemaining: timeRemaining.data,
    pendingClaim,
    balance: balance.data,
    allowance: allowance.data,
    loading: round.isPending || potTotal.isPending || timeRemaining.isPending,
    configured: !!GAME_ADDRESS && !!TOKEN_ADDRESS,
  };
}

export function useCountdown(timeRemaining) {
  const [, setTick] = useState(0);
  // Anchor the chain value to the moment we observed it; re-anchor whenever the
  // contract reports a new value (e.g. a bid resets it to 180, or the bell drops it
  // to 0 while views auto-advance to the next round). The 1s interval only drives
  // re-renders.
  const [anchor, setAnchor] = useState(null);
  const raw = timeRemaining != null ? Number(timeRemaining) : null;

  useEffect(() => {
    if (raw == null) {
      setAnchor(null);
      return;
    }
    setAnchor((a) => (a && a.raw === raw ? a : { raw, at: Math.floor(Date.now() / 1000) }));
  }, [raw]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (raw == null || !anchor) return { remaining: null, ready: false };

  const since = Math.floor(Date.now() / 1000) - anchor.at;
  const remaining = Math.max(0, anchor.raw - since);
  // Never overshoot the latest chain-reported value between polls.
  return { remaining: Math.min(remaining, raw), ready: true };
}

export function useBidFeed(target) {
  const publicClient = usePublicClient({ chainId: target?.id });
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicClient || !GAME_ADDRESS) return;
    let cancelled = false;
    const fetchLate = async () => {
      try {
        if (document.visibilityState === "hidden") return;
        const latest = await publicClient.getBlockNumber();
        const fromBlock = latest > 2000n ? latest - 2000n : 0n;
        const logs = await publicClient.getLogs({
          address: GAME_ADDRESS,
          event: parseAbiItem(
            "event Bid(uint256 indexed round, address indexed bidder, uint256 amount, uint256 topBid, uint256 potTotal, uint256 roundEndsAt)"
          ),
          fromBlock,
          toBlock: "latest",
        });
        if (cancelled) return;
        setBids(logs.slice(-20).map((l) => l.args).reverse());
      } catch (_) {
        /* polling continues */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchLate();
    const id = setInterval(fetchLate, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicClient]);

  return { bids, loading };
}