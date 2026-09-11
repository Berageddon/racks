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

  const round = useReadContract({ ...common, functionName: "round" });
  const potTotal = useReadContract({ ...common, functionName: "potTotal" });
  const topBid = useReadContract({ ...common, functionName: "topBid" });
  const topBidder = useReadContract({ ...common, functionName: "topBidder" });
  const roundEndsAt = useReadContract({ ...common, functionName: "roundEndsAt" });
  const tick = useReadContract({ ...common, functionName: "tick" });
  const roundTime = useReadContract({ ...common, functionName: "roundTime" });
  const devWallet = useReadContract({ ...common, functionName: "devWallet" });

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
    roundEndsAt: roundEndsAt.data,
    tick: tick.data,
    roundTime: roundTime.data,
    devWallet: devWallet.data,
    balance: balance.data,
    allowance: allowance.data,
    loading: round.isPending || potTotal.isPending,
    configured: !!GAME_ADDRESS && !!TOKEN_ADDRESS,
  };
}

export function useCountdown(endsAt) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = endsAt ? Number(endsAt) - now : 0;
  return { remaining: Math.max(remaining, 0), now };
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