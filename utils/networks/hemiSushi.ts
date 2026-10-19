import { ethers } from 'ethers';
import { HEMI_CHAIN_ID, HEMI_RPC } from './chains';
import { sendHemiCall } from './hemi';
import { networkFetch } from './http';

/** Sushi router on Hemi. The swap API must aim the transaction here. */
const HEMI_SUSHI_ROUTER = '0xac4c6e212a361c968f1725b4d055b47e63f80b75';
/** USDT on Hemi. 6 decimals. */
export const HEMI_USDT = '0xbB0D083fb1be0A9f6157ec484b6C79E0A4e31C2e';
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256)',
];

export type HemiSushiDirection = 'ETH_TO_USDT' | 'USDT_TO_ETH';

export type HemiSushiLeg = {
  symbol: string;
  address: string;
  decimals: number;
  native: boolean;
};

export type HemiSushiQuote = {
  pay: HemiSushiLeg;
  receive: HemiSushiLeg;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  slippageBps: number;
};

export const HEMI_SUSHI_ETH: HemiSushiLeg = {
  symbol: 'ETH',
  address: NATIVE,
  decimals: 18,
  native: true,
};

export const HEMI_SUSHI_USDT: HemiSushiLeg = {
  symbol: 'USDT',
  address: HEMI_USDT,
  decimals: 6,
  native: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function provider(): ethers.JsonRpcProvider {
  const network = ethers.Network.from(HEMI_CHAIN_ID);
  return new ethers.JsonRpcProvider(HEMI_RPC, network, { staticNetwork: network });
}

function legAddress(leg: HemiSushiLeg): string {
  return leg.native ? NATIVE : leg.address;
}

function sameToken(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function readHemiSwapBalances(address: string): Promise<{ eth: bigint; usdt: bigint }> {
  const client = provider();
  try {
    const usdt = new ethers.Contract(HEMI_USDT, ERC20_ABI, client);
    const [eth, raw] = await Promise.all([
      client.getBalance(address),
      usdt.balanceOf(address) as Promise<bigint>,
    ]);
    return { eth, usdt: raw };
  } finally {
    client.destroy();
  }
}

async function swapBody(
  pay: HemiSushiLeg,
  receive: HemiSushiLeg,
  amountIn: bigint,
  slippageBps: number,
  sender: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.sushi.com/swap/v7/${HEMI_CHAIN_ID}`);
  url.searchParams.set('tokenIn', legAddress(pay));
  url.searchParams.set('tokenOut', legAddress(receive));
  url.searchParams.set('amount', amountIn.toString());
  url.searchParams.set('maxSlippage', (slippageBps / 10_000).toString());
  url.searchParams.set('sender', sender);
  const res = await networkFetch(url.toString());
  const body = await res.json() as unknown;
  if (!isRecord(body)) throw new Error('Sushi returned an incomplete quote.');
  if (!res.ok || body.status !== 'Success') {
    throw new Error(body.status === 'NoWay' ? 'Sushi has no route for that amount on Hemi.' : 'Sushi returned an incomplete quote.');
  }
  return body;
}

function readQuote(
  body: Record<string, unknown>,
  pay: HemiSushiLeg,
  receive: HemiSushiLeg,
  amountIn: bigint,
  slippageBps: number,
): HemiSushiQuote {
  const tokens = Array.isArray(body.tokens) ? body.tokens : [];
  const from = tokens[Number(body.tokenFrom)];
  const to = tokens[Number(body.tokenTo)];
  if (!isRecord(from) || !isRecord(to) || typeof from.address !== 'string' || typeof to.address !== 'string') {
    throw new Error('Sushi returned an incomplete quote.');
  }
  if (!sameToken(from.address, legAddress(pay)) || !sameToken(to.address, legAddress(receive))) {
    throw new Error('Sushi returned a different pair.');
  }
  let amountOut = 0n;
  try {
    amountOut = BigInt(String(body.assumedAmountOut || '0'));
  } catch {
    amountOut = 0n;
  }
  if (amountOut <= 0n) throw new Error('Sushi returned an empty quote.');
  const amountOutMin = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  if (amountOutMin <= 0n) throw new Error('Sushi returned an empty quote.');
  return { pay, receive, amountIn, amountOut, amountOutMin, slippageBps };
}

function readTx(body: Record<string, unknown>, pay: HemiSushiLeg, amountIn: bigint, sender: string): { to: string; data: string; value: bigint } {
  const tx = isRecord(body.tx) ? body.tx : null;
  if (!tx || typeof tx.to !== 'string' || typeof tx.data !== 'string') {
    throw new Error('Sushi did not return a transaction.');
  }
  const to = ethers.getAddress(tx.to);
  if (to !== ethers.getAddress(HEMI_SUSHI_ROUTER)) {
    throw new Error('Sushi returned an unexpected contract.');
  }
  if (!/^0x[0-9a-fA-F]+$/.test(tx.data) || tx.data.length < 10) {
    throw new Error('Sushi did not return a transaction.');
  }
  const value = tx.value == null || tx.value === '0' ? 0n : BigInt(String(tx.value));
  if (pay.native && value !== amountIn) {
    throw new Error('Sushi asked for a different ETH amount.');
  }
  if (!pay.native && value !== 0n) {
    throw new Error('Sushi asked for ETH on a token swap.');
  }
  if (typeof tx.from === 'string' && tx.from && ethers.getAddress(tx.from) !== ethers.getAddress(sender)) {
    throw new Error('Sushi changed the wallet address on this quote.');
  }
  return { to, data: tx.data, value };
}

/** Same-chain quote on Hemi. Sushi prices the pair. This is not a bridge. */
export async function quoteHemiSushiPair(
  pay: HemiSushiLeg,
  receive: HemiSushiLeg,
  amountIn: bigint,
  slippageBps: number,
  sender: string,
): Promise<HemiSushiQuote> {
  if (pay.native && receive.native) throw new Error('Choose two different assets.');
  if (!pay.native && pay.address.toLowerCase() === receive.address.toLowerCase()) {
    throw new Error('Choose two different assets.');
  }
  const body = await swapBody(pay, receive, amountIn, slippageBps, sender);
  return readQuote(body, pay, receive, amountIn, slippageBps);
}

/** ETH and USDT, kept for the original pair. */
export async function quoteHemiSushi(
  direction: HemiSushiDirection,
  amountIn: bigint,
  slippageBps: number,
  sender: string,
): Promise<HemiSushiQuote> {
  const pay = direction === 'ETH_TO_USDT' ? HEMI_SUSHI_ETH : HEMI_SUSHI_USDT;
  const receive = direction === 'ETH_TO_USDT' ? HEMI_SUSHI_USDT : HEMI_SUSHI_ETH;
  return quoteHemiSushiPair(pay, receive, amountIn, slippageBps, sender);
}

/** Re-quote, approve the token when needed, and send only to the Hemi Sushi router. */
export async function executeHemiSushi(quote: HemiSushiQuote, sender: string): Promise<string> {
  const client = provider();
  try {
    const hex = await client.send('eth_chainId', []);
    if (BigInt(hex) !== BigInt(HEMI_CHAIN_ID)) throw new Error('Hemi RPC is not mainnet.');
    if (!quote.pay.native) {
      const token = new ethers.Contract(quote.pay.address, ERC20_ABI, client);
      const allowance = await token.allowance(sender, HEMI_SUSHI_ROUTER) as bigint;
      if (allowance < quote.amountIn) {
        const data = token.interface.encodeFunctionData('approve', [HEMI_SUSHI_ROUTER, quote.amountIn]);
        await sendHemiCall({ to: quote.pay.address, data });
      }
    }
  } finally {
    client.destroy();
  }
  const body = await swapBody(quote.pay, quote.receive, quote.amountIn, quote.slippageBps, sender);
  const fresh = readQuote(body, quote.pay, quote.receive, quote.amountIn, quote.slippageBps);
  if (fresh.amountOut < quote.amountOutMin) {
    throw new Error('The price moved past the minimum you confirmed. Quote it again.');
  }
  const tx = readTx(body, quote.pay, quote.amountIn, sender);
  return sendHemiCall(tx);
}
