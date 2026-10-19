import { ethers } from 'ethers';
import { ETH_CHAIN_ID, ETH_RPC } from '../ethTokens';
import { sendEthCall } from '../ethChain';
import { HEMI_CHAIN_ID, HEMI_RPC } from './chains';
import { sendHemiCall } from './hemi';

/**
 * Stargate V2 native ETH pools from the public metadata (asset 13).
 * Endpoint ids are LayerZero V2 eid() on each chain.
 */
const ETHEREUM = {
  eid: 30101,
  pool: '0x77b2043768d28E9C9aB44E1aBfC95944bcE57931',
} as const;
const HEMI = {
  eid: 30329,
  pool: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590',
} as const;

const ABI = [
  'function quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam) view returns ((uint256 minAmountLD, uint256 maxAmountLD) limit, (int256 feeAmountLD, string description)[] details, (uint256 amountSentLD, uint256 amountReceivedLD) receipt)',
  'function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)',
  'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable',
];

export type StargateDirection = 'to-hemi' | 'to-ethereum';

export type StargateQuote = {
  direction: StargateDirection;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  value: bigint;
};

type SendParam = {
  dstEid: number;
  to: string;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: string;
  composeMsg: string;
  oftCmd: string;
};

function source(direction: StargateDirection): { eid: number; pool: string; rpc: string; chainId: number } {
  if (direction === 'to-hemi') {
    return { eid: HEMI.eid, pool: ETHEREUM.pool, rpc: ETH_RPC, chainId: ETH_CHAIN_ID };
  }
  return { eid: ETHEREUM.eid, pool: HEMI.pool, rpc: HEMI_RPC, chainId: HEMI_CHAIN_ID };
}

function provider(direction: StargateDirection): ethers.JsonRpcProvider {
  const src = source(direction);
  const network = ethers.Network.from(src.chainId);
  return new ethers.JsonRpcProvider(src.rpc, network, { staticNetwork: network });
}

function param(direction: StargateDirection, recipient: string, amount: bigint, min: bigint): SendParam {
  return {
    dstEid: source(direction).eid,
    to: ethers.zeroPadValue(ethers.getAddress(recipient), 32),
    amountLD: amount,
    minAmountLD: min,
    extraOptions: '0x',
    composeMsg: '0x',
    oftCmd: '0x',
  };
}

async function liveQuote(direction: StargateDirection, recipient: string, amount: bigint): Promise<StargateQuote> {
  if (amount <= 0n) throw new Error('Enter an ETH amount.');
  const client = provider(direction);
  try {
    const pool = new ethers.Contract(source(direction).pool, ABI, client);
    const draft = param(direction, recipient, amount, 0n);
    const oft = await pool.quoteOFT(draft);
    const received = oft.receipt?.amountReceivedLD ?? oft[2]?.amountReceivedLD;
    if (typeof received !== 'bigint' || received <= 0n || received > amount) {
      throw new Error('Stargate returned an empty quote.');
    }
    const priced = param(direction, recipient, amount, received);
    const fee = await pool.quoteSend(priced, false);
    const nativeFee = fee.nativeFee ?? fee[0];
    if (typeof nativeFee !== 'bigint' || nativeFee <= 0n) {
      throw new Error('Stargate did not return a network fee.');
    }
    return {
      direction,
      amountIn: amount,
      amountOut: received,
      fee: nativeFee,
      value: amount + nativeFee,
    };
  } finally {
    client.destroy();
  }
}

/** Native ETH taxi quote. The message fee is paid on top of the amount. */
export async function quoteStargate(
  direction: StargateDirection,
  recipient: string,
  amount: bigint,
): Promise<StargateQuote> {
  return liveQuote(direction, recipient, amount);
}

/** Re-quote, then send only to the published pool if the received amount and fee still match. */
export async function executeStargate(quote: StargateQuote, sender: string): Promise<string> {
  if (quote.direction === 'to-ethereum') {
    const client = provider(quote.direction);
    try {
      const hex = await client.send('eth_chainId', []);
      if (BigInt(hex) !== BigInt(HEMI_CHAIN_ID)) throw new Error('Hemi RPC is not mainnet.');
    } finally {
      client.destroy();
    }
  }
  const fresh = await liveQuote(quote.direction, sender, quote.amountIn);
  if (fresh.amountOut < quote.amountOut) {
    throw new Error('Stargate lowered the amount you receive. Review it again.');
  }
  if (fresh.fee > quote.fee) {
    throw new Error('Stargate raised the message fee. Review it again.');
  }
  const pool = ethers.getAddress(source(quote.direction).pool);
  const iface = new ethers.Interface(ABI);
  const data = iface.encodeFunctionData('send', [
    param(quote.direction, sender, quote.amountIn, fresh.amountOut),
    [fresh.fee, 0n],
    ethers.getAddress(sender),
  ]);
  const value = quote.amountIn + fresh.fee;
  if (quote.direction === 'to-hemi') {
    const receipt = await sendEthCall({ to: pool, data, value });
    return receipt.hash;
  }
  return sendHemiCall({ to: pool, data, value });
}
