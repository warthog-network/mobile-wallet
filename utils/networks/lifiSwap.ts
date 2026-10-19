import AsyncStorage from '@react-native-async-storage/async-storage';
import { base64 } from '@scure/base';
import { assertBtcAddress, fetchBtcBalance, sendBtcPayment } from './btc';
import { networkFetch } from './http';
import { assertOwnSolanaTransaction, sendRawSolana, signSolanaTransaction } from './solana';
import { formatUnits } from './units';

const LIFI = 'https://li.quest/v1';
const STORE_KEY = 'warthogLifiSwaps';
/** Wide enough that Chainflip is not dropped for its 1.5% recommendation. */
const SLIPPAGE = '0.015';
const SOL_CHAIN = 1151111081099710;
const BTC_CHAIN = 20000000000001;
const SOL_TOKEN = '11111111111111111111111111111111';
const BTC_TOKEN = 'bitcoin';

export type LifiAsset = 'SOL' | 'BTC';

interface LifiRequest {
  kind: 'sol' | 'btc';
  rawB64?: string;
  to?: string;
  sats?: bigint;
  memo?: string;
}

export interface LifiRoute {
  tool: string;
  toolLabel: string;
  expectedOut: bigint;
  minOut: bigint;
  seconds: number;
  recommended: boolean;
}

export interface LifiQuote extends LifiRoute {
  from: LifiAsset;
  to: LifiAsset;
  amountIn: bigint;
  request: LifiRequest;
}

export interface LifiMove {
  id: string;
  direction: 'sol-to-btc' | 'btc-to-sol';
  createdAt: number;
  amountIn: string;
  expectedOut: string;
  from: string;
  to: string;
  txHash: string;
  tool: string;
  toolLabel: string;
  fromChain: 'sol' | 'btc';
  toChain: 'sol' | 'btc';
  status: 'submitted' | 'done' | 'refunded' | 'failed';
}

export interface LifiStatus {
  status: string;
  substatus: string;
  substatusMessage: string;
}

const TOOL_LABELS: Record<string, string> = {
  relay: 'Relay',
  relaydepository: 'Relay',
  chainflip: 'Chainflip',
  chainflipdca: 'Chainflip',
  near: 'NEAR Intents',
};

export function formatLifi(amount: bigint, asset: LifiAsset): string {
  return formatUnits(amount, asset === 'SOL' ? 9 : 8);
}

export function formatLifiWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Any moment';
  if (seconds < 90) return 'About a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'About 1 minute' : `About ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) {
    if (rem === 0) return hours === 1 ? 'About 1 hour' : `About ${hours} hours`;
    return `About ${hours}h ${rem}m`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'About 1 day' : `About ${days} days`;
}

function toolLabel(tool: string, title?: string): string {
  return TOOL_LABELS[tool.toLowerCase()] || title || tool;
}

function cleanLifiMessage(message: string): string {
  const text = message.replace(/^error:\s*/i, '').trim();
  if (/no utxos/i.test(text)) return 'No Bitcoin to swap.';
  if (/no available quotes|no route/i.test(text)) return 'LI.FI has no route for that amount right now.';
  return text.slice(0, 220) || 'LI.FI rejected the quote.';
}

async function lifiJson(url: string): Promise<unknown> {
  const res = await networkFetch(url);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body && typeof body === 'object' && body && 'message' in body
      ? String((body as { message: unknown }).message)
      : text;
    throw new Error(cleanLifiMessage(message || 'LI.FI rejected the quote.'));
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isNative(token: unknown, asset: LifiAsset): boolean {
  if (!isRecord(token)) return false;
  if (String(token.symbol || '').toUpperCase() !== asset) return false;
  const address = String(token.address || '').toLowerCase();
  if (asset === 'BTC') return address === '' || address === 'bitcoin';
  return address === '' || address === '11111111111111111111111111111111';
}

function readRequest(from: LifiAsset, tx: Record<string, unknown>, owner: string, amountIn: bigint): LifiRequest {
  if (from === 'SOL') {
    const data = typeof tx.data === 'string' ? tx.data : '';
    if (!data || tx.svmTransactionVersion === undefined) {
      throw new Error('LI.FI did not return a Solana transaction.');
    }
    const raw = base64.decode(data);
    assertOwnSolanaTransaction(raw, owner);
    return { kind: 'sol', rawB64: data };
  }
  const to = typeof tx.to === 'string' ? tx.to : '';
  const memo = typeof tx.data === 'string' ? tx.data : '';
  const value = typeof tx.value === 'string' || typeof tx.value === 'number' ? BigInt(tx.value) : 0n;
  if (!to || value <= 0n) throw new Error('LI.FI did not return a Bitcoin deposit.');
  if (tx.psbt || memo.startsWith('cHNidP')) {
    throw new Error('This Bitcoin route returned a template this wallet does not sign.');
  }
  assertBtcAddress(to);
  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length < 1 || memoBytes.length > 80) {
    throw new Error('This Bitcoin route memo does not fit in an OP_RETURN.');
  }
  if (value > amountIn) throw new Error('The deposit is larger than the amount you entered.');
  return { kind: 'btc', to, sats: value, memo };
}

function chainId(asset: LifiAsset): number {
  return asset === 'SOL' ? SOL_CHAIN : BTC_CHAIN;
}

function tokenAddress(asset: LifiAsset): string {
  return asset === 'SOL' ? SOL_TOKEN : BTC_TOKEN;
}

function skippedTool(tool: string): boolean {
  return /thor/i.test(tool);
}

export async function listLifiRoutes(input: {
  from: LifiAsset;
  to: LifiAsset;
  amountIn: bigint;
  fromAddress: string;
  toAddress: string;
}): Promise<LifiRoute[]> {
  if (input.from === input.to) throw new Error('Choose SOL and BTC.');
  const res = await networkFetch(`${LIFI}/advanced/routes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fromChainId: chainId(input.from),
      toChainId: chainId(input.to),
      fromTokenAddress: tokenAddress(input.from),
      toTokenAddress: tokenAddress(input.to),
      fromAmount: input.amountIn.toString(),
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      options: { slippage: Number(SLIPPAGE), integrator: 'warthog', order: 'CHEAPEST' },
    }),
  });
  const body = await res.json() as { routes?: unknown; message?: string };
  if (!res.ok) throw new Error(cleanLifiMessage(body.message || 'LI.FI rejected the quote.'));
  if (!Array.isArray(body.routes)) throw new Error('LI.FI returned an incomplete quote.');
  const byTool = new Map<string, LifiRoute>();
  for (const route of body.routes) {
    if (!isRecord(route) || !Array.isArray(route.steps) || route.steps.length !== 1) continue;
    const step = route.steps[0];
    if (!isRecord(step)) continue;
    const tool = String(step.tool || '');
    if (!tool || skippedTool(tool)) continue;
    const estimate = isRecord(step.estimate) ? step.estimate : {};
    const details = isRecord(step.toolDetails) ? step.toolDetails : {};
    const expectedOut = BigInt(String(route.toAmount || '0'));
    const minOut = BigInt(String(route.toAmountMin || '0'));
    if (expectedOut <= 0n || minOut <= 0n || minOut > expectedOut) continue;
    const tags = Array.isArray(route.tags) ? route.tags.map(String) : [];
    const seconds = Number(estimate.executionDuration || 0);
    const next: LifiRoute = {
      tool,
      toolLabel: toolLabel(tool, typeof details.name === 'string' ? details.name : undefined),
      expectedOut,
      minOut,
      seconds: Number.isFinite(seconds) ? seconds : 0,
      recommended: tags.includes('RECOMMENDED') || tags.includes('CHEAPEST'),
    };
    const prev = byTool.get(tool);
    if (!prev || next.expectedOut > prev.expectedOut) byTool.set(tool, next);
  }
  const routes = [...byTool.values()].sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return a.expectedOut > b.expectedOut ? -1 : 1;
  });
  if (routes.length === 0) throw new Error('LI.FI has no route for that amount right now.');
  return routes;
}

export async function quoteLifiSwap(input: {
  from: LifiAsset;
  to: LifiAsset;
  amountIn: bigint;
  fromAddress: string;
  toAddress: string;
  tool: string;
}): Promise<LifiQuote> {
  if (input.from === input.to) throw new Error('Choose SOL and BTC.');
  if (skippedTool(input.tool)) throw new Error('That route is not available.');
  const params = new URLSearchParams({
    fromChain: input.from === 'SOL' ? 'sol' : 'btc',
    toChain: input.to === 'SOL' ? 'sol' : 'btc',
    fromToken: input.from === 'SOL' ? 'SOL' : 'BTC',
    toToken: input.to === 'SOL' ? 'SOL' : 'BTC',
    fromAmount: input.amountIn.toString(),
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    slippage: SLIPPAGE,
    allowBridges: input.tool,
    integrator: 'warthog',
  });
  const body = await lifiJson(`${LIFI}/quote?${params.toString()}`);
  if (!isRecord(body) || !isRecord(body.action) || !isRecord(body.estimate) || !isRecord(body.transactionRequest)) {
    throw new Error('LI.FI returned an incomplete quote.');
  }
  const action = body.action;
  if (action.fromAddress !== input.fromAddress || action.toAddress !== input.toAddress) {
    throw new Error('LI.FI changed the wallet address on this quote.');
  }
  if (!isNative(action.fromToken, input.from) || !isNative(action.toToken, input.to)) {
    throw new Error('LI.FI returned a route that is not native SOL and Bitcoin.');
  }
  const expectedOut = BigInt(String(body.estimate.toAmount || '0'));
  const minOut = BigInt(String(body.estimate.toAmountMin || '0'));
  if (expectedOut <= 0n || minOut <= 0n || minOut > expectedOut) {
    throw new Error('LI.FI returned an empty quote.');
  }
  const tool = String(body.tool || '');
  if (!tool || tool !== input.tool) throw new Error('LI.FI changed the route. Review it again.');
  const details = isRecord(body.toolDetails) ? body.toolDetails : {};
  const seconds = Number(body.estimate.executionDuration || 0);
  return {
    from: input.from,
    to: input.to,
    amountIn: input.amountIn,
    expectedOut,
    minOut,
    seconds: Number.isFinite(seconds) ? seconds : 0,
    tool,
    toolLabel: toolLabel(tool, typeof details.name === 'string' ? details.name : undefined),
    recommended: false,
    request: readRequest(input.from, body.transactionRequest, input.fromAddress, input.amountIn),
  };
}

export async function executeLifiSwap(quote: LifiQuote, owner: string): Promise<string> {
  if (quote.request.kind === 'sol') {
    const raw = base64.decode(quote.request.rawB64 || '');
    const signed = await signSolanaTransaction(raw, owner);
    return await sendRawSolana(signed);
  }
  const to = quote.request.to || '';
  const sats = quote.request.sats ?? 0n;
  const memo = quote.request.memo || '';
  if (/chainflip/i.test(quote.tool)) {
    const balance = await fetchBtcBalance(owner);
    if (balance < sats + 3_000n) {
      throw new Error('Leave a little Bitcoin. Chainflip refunds the spare change to this wallet.');
    }
  }
  const sent = await sendBtcPayment({
    to,
    sats,
    memo: new TextEncoder().encode(memo),
    memoAfterChange: false,
  });
  return sent.txid;
}

export async function readLifiStatus(move: Pick<LifiMove, 'txHash' | 'fromChain' | 'toChain' | 'tool'>): Promise<LifiStatus | null> {
  try {
    const params = new URLSearchParams({
      txHash: move.txHash,
      fromChain: move.fromChain,
      toChain: move.toChain,
      bridge: move.tool,
    });
    const res = await networkFetch(`${LIFI}/status?${params.toString()}`);
    if (res.status === 404) return { status: 'NOT_FOUND', substatus: '', substatusMessage: '' };
    const body = await res.json() as { status?: string; substatus?: string; substatusMessage?: string; message?: string };
    if (!res.ok) return null;
    return {
      status: String(body.status || ''),
      substatus: String(body.substatus || ''),
      substatusMessage: String(body.substatusMessage || ''),
    };
  } catch {
    return null;
  }
}

export function lifiOutcome(status: LifiStatus | null): LifiMove['status'] | 'pending' {
  if (!status || status.status === 'NOT_FOUND' || status.status === 'PENDING' || status.status === 'INVALID') return 'pending';
  if (status.status === 'FAILED') return 'failed';
  if (status.status === 'DONE' && /REFUND/i.test(status.substatus)) return 'refunded';
  if (status.status === 'DONE') return 'done';
  return 'pending';
}

export function lifiStep(status: LifiStatus | null, toolLabelText: string): { step: string; eta: string } {
  if (!status || status.status === 'NOT_FOUND') {
    return { step: `Waiting for ${toolLabelText} to see this transaction`, eta: 'Checking about every 20 seconds' };
  }
  if (status.status === 'PENDING' || status.status === 'INVALID') {
    return { step: 'Swap in progress', eta: status.substatusMessage || 'The other chain pays this wallet' };
  }
  if (status.status === 'DONE' && /REFUND/i.test(status.substatus)) {
    return { step: 'Refunded', eta: 'The deposit was sent back' };
  }
  if (status.status === 'DONE') return { step: 'Paid out', eta: 'The other chain has the payment' };
  if (status.status === 'FAILED') return { step: 'Swap failed', eta: status.substatusMessage || 'LI.FI marked this swap failed' };
  return { step: 'Checking the swap', eta: 'Checking about every 20 seconds' };
}

export async function readLifiMoves(solAddress: string, btcAddress: string): Promise<LifiMove[]> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as LifiMove[];
    const sol = solAddress.toLowerCase();
    const btc = btcAddress.toLowerCase();
    return rows.filter((row) => row.from.toLowerCase() === sol || row.from.toLowerCase() === btc);
  } catch {
    return [];
  }
}

export async function saveLifiMove(move: LifiMove): Promise<void> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  const rows = raw ? (JSON.parse(raw) as LifiMove[]) : [];
  const next = [move, ...rows.filter((row) => row.id !== move.id)].slice(0, 40);
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
}

export async function markLifiMove(id: string, status: LifiMove['status']): Promise<void> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  if (!raw) return;
  const rows = JSON.parse(raw) as LifiMove[];
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(rows.map((row) => (row.id === id ? { ...row, status } : row))));
}
