/**
 * Explorer indexer client for mobile history (WartBunker / extension parity).
 * Prefer `/api/explorer` on the same host for type filters (group=limit_swap etc.).
 * Mainnet warthognode.duckdns.org serves that indexer beside the node RPC.
 * Node RPC has no type filter — falls back to client hunt on node pages.
 */
import { DEFI_TESTNET_URL } from '../constants';
import { isDefiNode, normalizeNodeUrl } from './nodes';
import { historyFilterToIndexerQuery } from './historyFilters';
import type { NormalizedHistoryTx } from './historyParser';

export const DEFAULT_INDEXER_BASE = `${DEFI_TESTNET_URL.replace(/\/+$/, '')}/api/explorer`;

const PAGE_COUNT_DEFAULT = 50;
const INDEXER_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function isLoopbackNode(node: string): boolean {
  try {
    const u = new URL(normalizeNodeUrl(node));
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  } catch {
    return /localhost|127\.0\.0\.1/i.test(node);
  }
}

/** Resolve explorer indexer base, or null → use node history only. */
export function resolveIndexerBase(nodeBase: string): string | null {
  const node = normalizeNodeUrl(nodeBase);
  if (!node) return null;

  try {
    const u = new URL(node);
    if (u.hostname.toLowerCase().includes('defitestnet')) {
      return `${node.replace(/\/+$/, '')}/api/explorer`;
    }
  } catch {
    /* ignore */
  }

  if (isLoopbackNode(node)) return null;
  if (isDefiNode(node)) return DEFAULT_INDEXER_BASE;
  // Public nodes, including mainnet, expose the explorer indexer on the same host.
  // fetchIndexerHistoryPage checks /health and falls back to node history if it is down.
  return `${node.replace(/\/+$/, '')}/api/explorer`;
}

export function cleanIndexerAddress(address: string): string {
  return String(address || '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
}

async function indexerFetch(indexerBase: string, path: string): Promise<unknown> {
  const base = String(indexerBase || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  const res = await fetchWithTimeout(`${base}${p}`, INDEXER_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`);
  return res.json();
}

export async function fetchIndexerHealth(
  indexerBase: string,
): Promise<{ ok: boolean; dbHeight: number | null }> {
  try {
    const body = (await indexerFetch(indexerBase, '/health')) as {
      ok?: boolean;
      dbHeight?: number;
    };
    if (body && typeof body === 'object' && 'ok' in body) {
      return {
        ok: Boolean(body.ok),
        dbHeight: Number.isFinite(Number(body.dbHeight)) ? Number(body.dbHeight) : null,
      };
    }
  } catch {
    /* offline */
  }
  return { ok: false, dbHeight: null };
}

function mapIndexerTxType(raw: string | undefined): string {
  const t = String(raw || '')
    .toLowerCase()
    .replace(/-/g, '_');
  if (!t) return 'unknown';
  if (t === 'reward') return 'reward';
  if (t === 'transfer' || t === 'wart_transfer' || t === 'warttransfer') return 'wart_transfer';
  if (t === 'token_transfer' || t === 'tokentransfer') return 'token_transfer';
  if (t === 'limit_swap' || t === 'limitswap') return 'limit_swap';
  if (t === 'match') return 'match';
  if (t === 'cancelation' || t === 'cancellation' || t.includes('cancel')) return 'cancelation';
  if (t === 'asset_creation' || t === 'assetcreation') return 'asset_creation';
  if (t === 'liquidity_deposit' || t === 'liquiditydeposit') return 'liquidity_deposit';
  if (
    t === 'liquidity_withdrawal' ||
    t === 'liquiditywithdrawal' ||
    t.includes('liquiditywithdraw')
  ) {
    return 'liquidity_withdrawal';
  }
  return t;
}

type IndexerTxRow = {
  type?: string;
  hash?: string;
  amount?: string | number;
  fee?: string | number;
  sender?: string;
  recipient?: string;
  height?: number;
  timestamp?: number;
  direction?: string;
  meta?: { summary?: string; asset_name?: string; [k: string]: unknown } | null;
};

function normalizeIndexerTx(
  tx: IndexerTxRow,
  tipHeight: number | null,
): NormalizedHistoryTx {
  const type = mapIndexerTxType(tx?.type);
  const isReward = type === 'reward';
  const directionRaw = String(tx?.direction || '').toLowerCase();
  const sender = tx?.sender ? String(tx.sender) : '';
  const recipient = tx?.recipient ? String(tx.recipient) : '';
  const amount = tx?.amount != null ? String(tx.amount) : '0';
  const fee = tx?.fee != null ? String(tx.fee) : '0';
  const height = tx?.height != null ? Number(tx.height) : undefined;
  const timestamp = tx?.timestamp != null ? Number(tx.timestamp) : null;
  const hash = tx?.hash ? String(tx.hash) : 'N/A';

  const isIncoming =
    directionRaw === 'in' || isReward || type === 'liquidity_withdrawal';

  let asset = 'WART';
  let description = '';
  const meta = tx?.meta && typeof tx.meta === 'object' ? tx.meta : null;
  if (meta?.summary) {
    description = String(meta.summary);
  }
  if (meta?.asset_name) {
    asset = String(meta.asset_name);
  }

  if (!description) {
    switch (type) {
      case 'reward':
        description = `Block reward ${amount} WART`;
        break;
      case 'wart_transfer':
        description = isIncoming ? `Received ${amount} WART` : `Sent ${amount} WART`;
        break;
      case 'limit_swap':
        description = amount && amount !== '0' ? `Limit order ${amount}` : 'Limit order placed';
        break;
      case 'match':
        description = 'DEX match';
        break;
      case 'cancelation':
        description = 'Canceled order';
        break;
      case 'liquidity_deposit':
        description = 'Liquidity deposit';
        break;
      case 'liquidity_withdrawal':
        description = 'Liquidity withdrawal';
        break;
      case 'asset_creation':
        description = 'Asset creation';
        break;
      case 'token_transfer':
        asset = asset !== 'WART' ? asset : 'TOKEN';
        description = isIncoming ? `Received ${amount}` : `Sent ${amount}`;
        break;
      default:
        description = type || 'Transaction';
    }
  }

  let confirmations: number | undefined;
  if (
    tipHeight != null &&
    height != null &&
    Number.isFinite(tipHeight) &&
    Number.isFinite(height)
  ) {
    confirmations = Math.max(0, tipHeight - height + 1);
  }

  return {
    txid: hash,
    fromAddress: sender || null,
    toAddress: recipient || null,
    amount,
    fee,
    confirmations,
    height,
    timestamp,
    isReward,
    type,
    asset,
    description,
    isIncoming,
    category: type,
  };
}

export type IndexerHistoryPage = {
  items: NormalizedHistoryTx[];
  hasMore: boolean;
  nextPage: number;
  source: 'indexer';
};

/**
 * Fetch one page of history from the explorer indexer with optional type filter.
 * Returns null if no indexer / unhealthy / error (caller uses node fallback).
 */
export async function fetchIndexerHistoryPage(
  nodeBase: string,
  address: string,
  options: { page?: number; filter?: string; count?: number } = {},
): Promise<IndexerHistoryPage | null> {
  const indexerBase = resolveIndexerBase(nodeBase);
  if (!indexerBase) return null;

  const page = Math.max(1, options.page ?? 1);
  const filterId = options.filter || 'all';
  const count = Math.min(100, Math.max(1, options.count ?? PAGE_COUNT_DEFAULT));
  const addr = cleanIndexerAddress(address);
  if (!/^[0-9a-f]{48}$/.test(addr)) return null;

  try {
    const health = await fetchIndexerHealth(indexerBase);
    if (!health.ok) return null;

    const query = historyFilterToIndexerQuery(filterId);
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('count', String(count));
    if (query.group) qs.set('group', query.group);
    if (query.direction) qs.set('direction', query.direction);

    const body = (await indexerFetch(
      indexerBase,
      `/accounts/${addr}/transactions?${qs.toString()}`,
    )) as { code?: number; error?: string; data?: { transactions?: IndexerTxRow[] } };

    if (body?.code !== 0) {
      throw new Error(body?.error || 'Indexer history error');
    }

    const txs = Array.isArray(body?.data?.transactions) ? body!.data!.transactions! : [];
    const items = txs.map((tx) => normalizeIndexerTx(tx, health.dbHeight));

    return {
      items,
      hasMore: txs.length >= count,
      nextPage: page + 1,
      source: 'indexer',
    };
  } catch (err) {
    console.warn('[mobile history] indexer failed', err);
    return null;
  }
}

export function indexerAvailableForNode(nodeBase: string): boolean {
  return resolveIndexerBase(nodeBase) != null;
}
