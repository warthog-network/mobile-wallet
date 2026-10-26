import AsyncStorage from '@react-native-async-storage/async-storage';
import { ethers } from 'ethers';
import { ETH_CHAIN_ID, ETH_RPC } from '../ethTokens';
import { sendEthCall } from '../ethChain';
import { HEMI_CHAIN_ID, HEMI_RPC } from './chains';
import { sendHemiCall } from './hemi';
import { networkFetch } from './http';

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

const STORE_KEY = 'warthogStargateMoves';
const SCAN = 'https://scan.layerzero-api.com/v1/messages/tx';

export type StargateMove = {
  id: string;
  direction: StargateDirection;
  createdAt: number;
  amountIn: string;
  amountOut: string;
  address: string;
  txHash: string;
  status: 'inflight' | 'delivered' | 'failed';
};

/** Null means the scan request failed. `indexed: false` means Stargate has not listed this hash yet. */
export type StargateStage = {
  indexed: boolean;
  name: string;
  source: string;
  destination: string;
};

export type StargateView = {
  spinning: boolean;
  done: boolean;
  failed: boolean;
  step: string;
  message: string;
};

const FAILED = new Set([
  'FAILED',
  'SIMULATION_REVERTED',
  'PAYLOAD_STORED',
  'APPLICATION_BURNED',
  'APPLICATION_SKIPPED',
  'UNRESOLVABLE_COMMAND',
  'MALFORMED_COMMAND',
]);

function sameHash(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isMove(value: unknown): value is StargateMove {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StargateMove>;
  return typeof row.id === 'string'
    && (row.direction === 'to-hemi' || row.direction === 'to-ethereum')
    && typeof row.amountIn === 'string'
    && typeof row.amountOut === 'string'
    && typeof row.address === 'string'
    && typeof row.txHash === 'string'
    && (row.status === 'inflight' || row.status === 'delivered' || row.status === 'failed')
    && typeof row.createdAt === 'number';
}

async function readAll(): Promise<StargateMove[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isMove) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: StargateMove[]): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(rows.slice(0, 40)));
}

export async function readStargateMoves(address: string): Promise<StargateMove[]> {
  const mine = address.toLowerCase();
  return (await readAll()).filter((row) => row.address.toLowerCase() === mine);
}

export async function saveStargateMove(move: StargateMove): Promise<void> {
  const rows = await readAll();
  await writeAll([move, ...rows.filter((row) => row.id !== move.id)]);
}

/** LayerZero Scan by source hash. A 404, or a 200 whose source hash does not match, is not indexed yet. */
export async function readStargateStage(txHash: string): Promise<StargateStage | null> {
  const hash = txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return null;
  let response: Response;
  try {
    response = await networkFetch(`${SCAN}/${hash}`, { headers: { accept: 'application/json' } });
  } catch {
    return null;
  }
  if (response.status === 404) return { indexed: false, name: '', source: '', destination: '' };
  if (!response.ok) return null;
  let body: { data?: unknown };
  try {
    body = await response.json() as { data?: unknown };
  } catch {
    return null;
  }
  const rows = Array.isArray(body.data) ? body.data : [];
  const match = rows.find((row) => {
    if (!row || typeof row !== 'object') return false;
    const source = (row as { source?: { tx?: { txHash?: string } } }).source;
    return sameHash(source?.tx?.txHash || '', hash);
  }) as {
    status?: { name?: string };
    source?: { status?: string };
    destination?: { status?: string };
  } | undefined;
  if (!match) return { indexed: false, name: '', source: '', destination: '' };
  return {
    indexed: true,
    name: String(match.status?.name || ''),
    source: String(match.source?.status || ''),
    destination: String(match.destination?.status || ''),
  };
}

export function stargateStep(direction: StargateDirection, stage: StargateStage | null): StargateView {
  const from = direction === 'to-hemi' ? 'Ethereum' : 'Hemi';
  const to = direction === 'to-hemi' ? 'Hemi' : 'Ethereum';
  if (stage == null) {
    return {
      spinning: true,
      done: false,
      failed: false,
      step: 'Checking Stargate',
      message: 'The tracker will try again. This move is saved on this device.',
    };
  }
  if (!stage.indexed) {
    return {
      spinning: true,
      done: false,
      failed: false,
      step: `Step 1 of 3 · ${from} confirming`,
      message: `${from} has the transaction. Stargate has not indexed the message yet.`,
    };
  }
  const name = stage.name.toUpperCase();
  const source = stage.source.toUpperCase();
  const dest = stage.destination.toUpperCase();
  if (name === 'DELIVERED' || dest === 'SUCCEEDED') {
    return {
      spinning: false,
      done: true,
      failed: false,
      step: `Done · ETH is on ${to}`,
      message: `Stargate delivered the ETH on ${to}.`,
    };
  }
  if (FAILED.has(name) || FAILED.has(dest)) {
    const stored = name === 'PAYLOAD_STORED' || dest === 'PAYLOAD_STORED';
    return {
      spinning: false,
      done: false,
      failed: true,
      step: stored ? 'Step 3 of 3 · Needs a retry' : 'Stargate failed',
      message: stored
        ? `The message reached ${to} and is waiting for a manual retry.`
        : `Stargate could not finish this move on ${to}.`,
    };
  }
  if (name === 'BLOCKED') {
    return {
      spinning: true,
      done: false,
      failed: false,
      step: 'Step 2 of 3 · Waiting on an earlier message',
      message: 'Stargate is blocked by an earlier message on this pathway.',
    };
  }
  if (name === 'CONFIRMING' || dest === 'VALIDATING_TX') {
    return {
      spinning: true,
      done: false,
      failed: false,
      step: `Step 3 of 3 · Paying ${to}`,
      message: `The destination transaction is confirming on ${to}.`,
    };
  }
  if (source === 'WAITING' || source === 'VALIDATING_TX' || source === 'WAITING_FOR_HASH_DELIVERED' || source === '') {
    return {
      spinning: true,
      done: false,
      failed: false,
      step: `Step 1 of 3 · ${from} confirming`,
      message: source === 'VALIDATING_TX'
        ? `${from} included the transaction. Stargate is waiting for finality.`
        : `${from} has the transaction. Stargate is waiting for it to confirm.`,
    };
  }
  return {
    spinning: true,
    done: false,
    failed: false,
    step: 'Step 2 of 3 · Stargate in flight',
    message: `The message left ${from}. Stargate is delivering ETH on ${to}.`,
  };
}

export async function syncStargateMoves(address: string): Promise<{
  open: { move: StargateMove; view: StargateView }[];
  changed: { move: StargateMove; view: StargateView }[];
}> {
  const mine = address.toLowerCase();
  const rows = (await readAll()).filter((row) => row.address.toLowerCase() === mine);
  const open: { move: StargateMove; view: StargateView }[] = [];
  const changed: { move: StargateMove; view: StargateView }[] = [];
  await Promise.all(rows.map(async (row) => {
    if (row.status !== 'inflight') return;
    const view = stargateStep(row.direction, await readStargateStage(row.txHash));
    if (view.done) changed.push({ move: { ...row, status: 'delivered' }, view });
    else if (view.failed) changed.push({ move: { ...row, status: 'failed' }, view });
    else open.push({ move: row, view });
  }));
  if (changed.length > 0) {
    const latest = await readAll();
    const statusById = new Map(changed.map((item) => [item.move.id, item.move.status]));
    await writeAll(latest.map((row) => {
      const status = statusById.get(row.id);
      return status ? { ...row, status } : row;
    }));
  }
  return { open, changed };
}
