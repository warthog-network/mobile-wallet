// utils/api.ts - Blockchain API via warthog-ts 0.4.3 (legacy and DeFi clients).

import {
  DeFiWartBalance,
  WarthogDeFiApi,
  WarthogLegacyApi,
  Wart,
  RoundedFee,
  type AnyTransactionContext,
  type AnyWarthogApi,
  type LegacyTransactionJson,
  type NonceId,
  type TransactionJson,
} from 'warthog-ts';

import { API_ENDPOINTS, DEFAULT_FEE, SATOSHI_MULTIPLIER } from '../constants';
import { AccountBalance, BlockData, Transaction } from '../types';
import { isDefiNode } from './nodes';
import { formatAmountFromRaw, formatBalanceBreakdown } from './warthogFormat';

export type NodeResult<T> =
  | { success: true; data: T }
  | { success: false; code: number; error: string };

function nodeBase(node: string): string {
  return node.replace(/\/$/, '');
}

/** Legacy client on mainnet, DeFi client on the testnet. The URL is the wallet's node, not the library's known-node list. */
export function createWarthogApi(node: string): AnyWarthogApi {
  const base = nodeBase(node);
  return isDefiNode(base) ? new WarthogDeFiApi(base) : new WarthogLegacyApi(base);
}

/**
 * Read a node path the 0.4.3 clients do not expose (orders, market, tools, blocks).
 * The payload is `data` when `code` is 0.
 */
export async function nodeRequest<T = unknown>(
  node: string,
  path: string,
  queryParams?: Record<string, string | number>,
): Promise<NodeResult<T>> {
  const base = nodeBase(node);
  let url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (queryParams) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      params.append(key, String(value));
    }
    url += `?${params.toString()}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return {
      success: false,
      code: 0,
      error: `Network error contacting ${base}: ${message}`,
    };
  }

  const text = await response.text();
  let json: { code?: number; data?: T; error?: string };
  try {
    json = JSON.parse(text) as { code?: number; data?: T; error?: string };
  } catch {
    const preview = text.trim().slice(0, 120).replace(/\s+/g, ' ');
    return {
      success: false,
      code: response.status || 1,
      error: preview
        ? `Non-JSON node response (HTTP ${response.status}): ${preview}`
        : `Empty/non-JSON node response (HTTP ${response.status})`,
    };
  }

  if (json.code !== 0) {
    return {
      success: false,
      code: json.code ?? response.status,
      error: json.error || 'Unknown error',
    };
  }

  return { success: true, data: json.data as T };
}

export const fetchChainHead = async (node: string): Promise<BlockData> => {
  const api = createWarthogApi(node);
  const result = await api.getChainHead();
  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch chain head');
  }

  return {
    height: result.data.height,
    pinHeight: result.data.pin.pinHeight,
    pinHash: result.data.pin.pinHash,
  };
};

/** Build the transaction context for this node. The client fetches a pin that matches its API generation. */
export async function createTxContext(
  node: string,
  fee: RoundedFee,
  nonce: NonceId,
): Promise<AnyTransactionContext> {
  return createWarthogApi(node).createTransactionContext(fee, nonce);
}

type WartBalancePayload = {
  wart?: unknown;
  account?: { nonceId?: number | string };
};

type MainnetBalancePayload = {
  balance?: unknown;
  balanceE8?: number | string;
  nonceId?: number | string;
};

function parseDisplayNumber(str: string): number {
  const parsed = parseFloat(str);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAccountBalance(
  breakdown: ReturnType<typeof formatBalanceBreakdown>,
  nonceId: number,
): AccountBalance {
  return {
    balance: parseDisplayNumber(breakdown.total),
    available: parseDisplayNumber(breakdown.available),
    locked: parseDisplayNumber(breakdown.locked),
    balanceStr: breakdown.total,
    availableStr: breakdown.available,
    lockedStr: breakdown.locked,
    hasLocked: breakdown.hasLocked,
    nonceId,
  };
}

function accountFromRawUnits(
  total: bigint,
  locked: bigint,
  mempool: bigint,
  nonceId: number,
): AccountBalance {
  let availableRaw = total - locked - mempool;
  if (availableRaw < 0n) availableRaw = 0n;
  const totalStr = formatAmountFromRaw(total, 8);
  const lockedStr = formatAmountFromRaw(locked, 8);
  const availableStr = formatAmountFromRaw(availableRaw, 8);
  return {
    balance: parseDisplayNumber(totalStr),
    available: parseDisplayNumber(availableStr),
    locked: parseDisplayNumber(lockedStr),
    balanceStr: totalStr,
    availableStr,
    lockedStr,
    hasLocked: locked + mempool > 0n,
    nonceId,
  };
}

// Fetch account balance (mainnet: /balance, DeFi testnet: /wart_balance).
// The typed parsers cover the shapes warthog-ts 0.4.3 accepts. Other shapes
// keep the previous breakdown so a node that returns E8 or a container still loads.
// Nonce stays on the raw payload; the typed balance does not include it.
export const fetchAccountBalance = async (
  node: string,
  address: string,
): Promise<AccountBalance> => {
  if (isDefiNode(node)) {
    const result = await nodeRequest<WartBalancePayload>(node, `/account/${address}/wart_balance`);
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch account balance');
    }
    const nonceId = Number(result.data.account?.nonceId ?? 0);
    const parsed = DeFiWartBalance.parse(result.data);
    if (parsed) {
      return accountFromRawUnits(parsed.total.E8, parsed.locked.E8, parsed.mempool.E8, nonceId);
    }
    return toAccountBalance(formatBalanceBreakdown(result.data.wart, { kind: 'wart' }), nonceId);
  }

  const result = await nodeRequest<MainnetBalancePayload>(node, `/account/${address}/balance`);
  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch account balance');
  }

  const data = result.data;
  const nonceId = Number(data.nonceId || 0);
  if (typeof data.balance === 'string') {
    const wart = Wart.parse(data.balance);
    if (wart) return accountFromRawUnits(wart.E8, 0n, 0n, nonceId);
  }

  let container: unknown = data.balance;
  if (container == null && data.balanceE8 != null) {
    container = { E8: data.balanceE8 };
  } else if (typeof container === 'number' || typeof container === 'string') {
    const n = parseFloat(String(container));
    if (Number.isFinite(n)) {
      container = { str: String(container), E8: Math.round(n * SATOSHI_MULTIPLIER) };
    }
  }

  return toAccountBalance(formatBalanceBreakdown(container, { kind: 'wart' }), nonceId);
};

export const fetchUsdPrice = async (): Promise<number> => {
  try {
    const res = await fetch(API_ENDPOINTS.coingeckoPrice);
    const data = await res.json();
    return data.warthog?.usd || 0;
  } catch {
    return 0;
  }
};

// Resolve a valid rounded fee E8 using the node's encode16bit tool (exact compact fee).
// Local ceil-rounding can disagree with the node (e.g. 0.01 → 1000448 vs 999936).
export const fetchFeeE8 = async (node: string, feeWart: string): Promise<number> => {
  const feeStr = feeWart.trim() || DEFAULT_FEE;
  const wartFee = Wart.parse(feeStr);
  if (!wartFee) {
    throw new Error('Invalid fee amount');
  }

  try {
    const enc = await nodeRequest<{
      roundedE8?: number | string;
      rounded?: { E8?: number | string };
    }>(node, `/tools/encode16bit/from_string/${encodeURIComponent(feeStr)}`);
    if (enc.success) {
      const rounded = enc.data.roundedE8 ?? enc.data.rounded?.E8;
      if (rounded != null) return Number(rounded);
    }
  } catch {
    // fall through to local floor rounding
  }

  const fee = wartFee.roundedFee(false);

  try {
    const paths = ['/transaction/minfee', '/tools/minfee', '/tools/min_fee'];
    for (const path of paths) {
      const minRes = await nodeRequest<{ minFee?: { E8?: number | string; str?: string } }>(node, path);
      if (!minRes.success || minRes.data?.minFee?.E8 == null) continue;
      const minE8 = BigInt(minRes.data.minFee.E8);
      if (fee.E8 < minE8) {
        const minStr = minRes.data.minFee.str || 'node minimum';
        throw new Error(`Fee must be at least ${minStr}`);
      }
      break;
    }
  } catch (err) {
    if (err instanceof Error && /Fee must be at least/i.test(err.message)) {
      throw err;
    }
  }

  return Number(fee.E8);
};

export const submitWarthogTransaction = async (
  node: string,
  tx: TransactionJson | LegacyTransactionJson,
): Promise<{ txHash: string }> => {
  const result = await createWarthogApi(node).submitTransaction(tx);
  if (!result.success) {
    throw new Error(result.error || 'Node rejected transaction');
  }
  return { txHash: result.data.txHash || 'pending' };
};

export const fetchTransaction = async (
  node: string,
  txid: string,
): Promise<Transaction | null> => {
  try {
    const result = await nodeRequest<{ transaction?: Transaction }>(
      node,
      `/transaction/lookup/${txid}`,
    );
    if (!result.success) return null;
    return result.data.transaction ?? null;
  } catch {
    return null;
  }
};

export const fetchBlock = async (
  node: string,
  height: number,
): Promise<BlockData | null> => {
  try {
    const result = await nodeRequest<BlockData & {
      header?: { timestamp?: number; time?: { timestamp?: number } };
    }>(node, `/chain/block/${height}`);
    if (!result.success) return null;
    const data = result.data;
    return {
      height: Number(data.height || height),
      pinHeight: Number(data.pinHeight || height),
      pinHash: data.pinHash || '',
      timestamp: data.timestamp || data.header?.timestamp || data.header?.time?.timestamp,
      utc: data.utc,
    };
  } catch {
    return null;
  }
};
