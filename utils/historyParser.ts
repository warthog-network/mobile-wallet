const NODE_HISTORY_TIMEOUT_MS = 20000;
const NODE_BLOCK_TIMEOUT_MS = 8000;

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

export interface NormalizedHistoryTx {
  txid: string;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string;
  fee: string;
  confirmations?: number;
  height?: number;
  timestamp: number | null;
  isReward: boolean;
  type: string;
  asset: string;
  description: string;
  isIncoming: boolean;
  category: string;
}

type BlockEntry = {
  height?: number;
  confirmations?: number;
  header?: { time?: { timestamp?: number } };
  body?: Record<string, unknown>;
  transactions?: { transfers?: unknown[]; rewards?: unknown[] };
};

type HistoryPayload = {
  perBlock?: BlockEntry[];
  fromId?: number;
};

const asDisplayString = (value: unknown, fallback = ''): string => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.hex === 'string') return obj.hex;
    if (typeof obj.str === 'string') return obj.str;
    if (typeof obj.txHash === 'string') return obj.txHash;
    if (typeof obj.hash === 'string') return obj.hash;
    if (typeof obj.address === 'string') return obj.address;
  }
  return fallback;
};

const getAmountStr = (v: unknown, fallback = '0'): string => {
  if (v == null) return fallback;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const obj = v as { str?: string; E8?: number | string; u64?: number | string };
    if (obj.str != null) return String(obj.str);
    if (obj.E8 !== undefined) return (Number(obj.E8) / 100000000).toFixed(8);
    if (obj.u64 !== undefined) return String(obj.u64);
  }
  return fallback;
};

const getFeeStr = (v: unknown, fallback = '0'): string => {
  if (v == null) return fallback;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const obj = v as { str?: string; E8?: number | string };
    if (obj.str != null) return String(obj.str);
    if (obj.E8 !== undefined) return (Number(obj.E8) / 100000000).toFixed(8);
  }
  return fallback;
};

const abbreviate = (value: unknown) => {
  const str = asDisplayString(value);
  if (!str || str === 'N/A') return 'N/A';
  if (str.length <= 12) return str;
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
};

const formatRawAmount = (raw: bigint, precision = 8) => {
  const divisor = 10n ** BigInt(precision);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (precision === 0) return whole.toString();
  const fracStr = frac.toString().padStart(precision, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
};

const sumSwappedLeg = (swaps: Array<{ swapped?: Record<string, unknown> }>, leg: string) => {
  if (!swaps?.length) return null;
  if (swaps.length === 1) {
    const v = swaps[0]?.swapped?.[leg];
    return v ? getAmountStr(v) : null;
  }

  let total = 0n;
  let precision = 8;
  for (const swap of swaps) {
    const v = swap?.swapped?.[leg];
    if (!v || typeof v !== 'object') continue;
    const obj = v as { u64?: number | string; E8?: number | string; decimals?: number };
    if (obj.u64 !== undefined) {
      total += BigInt(obj.u64);
      if (obj.decimals !== undefined) precision = obj.decimals;
    } else if (obj.E8 !== undefined) {
      total += BigInt(obj.E8);
      precision = 8;
    }
  }
  return total > 0n ? formatRawAmount(total, precision) : null;
};

function normalizeTransaction(
  txItem: unknown,
  block: BlockEntry | undefined,
  categoryHint: string | null,
  viewingAddress: string | null
): NormalizedHistoryTx {
  const viewer = viewingAddress ? asDisplayString(viewingAddress).toLowerCase() : null;
  const addrEq = (a: unknown) => {
    const addr = asDisplayString(a);
    return !!(addr && viewer && addr.toLowerCase() === viewer);
  };

  const legacy = txItem as {
    txHash?: string;
    fromAddress?: string;
    toAddress?: string;
    amount?: string | number;
    amountE8?: number | string;
    fee?: unknown;
  };

  if (legacy?.txHash) {
    const fromA = asDisplayString(legacy.fromAddress, '') || null;
    const toAddr = asDisplayString(legacy.toAddress, 'N/A') || 'N/A';
    return {
      txid: asDisplayString(legacy.txHash, 'N/A'),
      fromAddress: fromA,
      toAddress: toAddr,
      amount: legacy.amount != null ? String(legacy.amount) : getAmountStr(legacy.amountE8),
      fee: getFeeStr(legacy.fee),
      confirmations: block?.confirmations,
      height: block?.height,
      timestamp: null,
      isReward: !fromA,
      type: !fromA ? 'reward' : 'wart_transfer',
      asset: 'WART',
      description: !fromA ? `Block reward ${legacy.amount || '0'} WART` : `Sent ${legacy.amount || '0'} WART`,
      isIncoming: addrEq(toAddr),
      category: categoryHint || (!fromA ? 'reward' : 'wartTransfer'),
    };
  }

  const item = txItem as {
    transaction?: Record<string, unknown>;
    data?: Record<string, unknown>;
    hash?: string;
    signedCommon?: Record<string, unknown>;
    fee?: unknown;
  };

  const tx = (item?.transaction ? item.transaction : item || {}) as Record<string, unknown>;
  const data = (tx.data as Record<string, unknown>) || item?.data || {};
  const common = (tx.signedCommon as Record<string, unknown>) || (tx.signingData as Record<string, unknown>) || item?.signedCommon || {};

  const hash = asDisplayString(tx.hash || item?.hash, 'N/A');
  const fromA = asDisplayString(common.originAddress || data.fromAddress, '') || null;
  const toA = asDisplayString(data.toAddress, '') || null;

  let typ = categoryHint || 'unknown';
  let amt = getAmountStr(data.amount);
  let assetSym = 'WART';
  let desc = '';
  let incoming = false;

  const cat = (categoryHint || '').toLowerCase();

  if (cat.includes('reward') || (!fromA && !data.toAddress && data.amount)) {
    typ = 'reward';
    amt = getAmountStr(data.amount);
    assetSym = 'WART';
    incoming = addrEq(toA);
    desc = `Block reward ${amt} WART`;
  } else if (cat.includes('wart')) {
    typ = 'wart_transfer';
    assetSym = 'WART';
    incoming = addrEq(toA);
    desc = incoming ? `Received ${amt} WART` : `Sent ${amt} WART to ${abbreviate(toA)}`;
  } else if (cat.includes('token')) {
    typ = 'token_transfer';
    const asset = data.asset as { name?: string } | undefined;
    assetSym = asset?.name || String(data.tokenSpec || 'TOKEN');
    amt = getAmountStr(data.amount);
    incoming = addrEq(toA);
    desc = `${incoming ? 'Received' : 'Sent'} ${amt} ${assetSym}`;
  } else if (cat.includes('limitswap') || cat.includes('limit_swap')) {
    typ = 'limit_swap';
    const baseAsset = data.baseAsset as { name?: string } | undefined;
    assetSym = baseAsset?.name || 'ASSET';
    amt = getAmountStr(data.amount);
    const limit = data.limit as { doubleAdjusted?: number } | number | undefined;
    const lim = typeof limit === 'object' && limit?.doubleAdjusted != null ? limit.doubleAdjusted : (limit || '?');
    const dir = data.buy ? 'BUY' : 'SELL';
    desc = `${dir} limit ${amt} ${assetSym} @ ${lim}`;
    incoming = false;
  } else if (cat.includes('liquiditydeposit') || cat.includes('liquidity_deposit')) {
    typ = 'liquidity_deposit';
    const baseAsset = data.baseAsset as { name?: string } | undefined;
    assetSym = asDisplayString(baseAsset?.name) || 'POOL';
    const dep = (data.deposited as Record<string, unknown>) || {};
    const processed = (tx.processed as Record<string, unknown>) || {};
    const sharesReceived = getAmountStr(processed.sharesReceived);
    amt = `${getAmountStr(dep.asset || dep.base || dep)} + ${getAmountStr(dep.wart || dep.quote || '0')}`;
    desc = sharesReceived && sharesReceived !== '0'
      ? `Deposited ${amt} into ${assetSym} pool → received ${sharesReceived} LP shares`
      : `Deposited liquidity into ${assetSym} pool`;
  } else if (cat.includes('liquiditywithdraw') || cat.includes('liquidity_withdrawal')) {
    typ = 'liquidity_withdrawal';
    const baseAsset = data.baseAsset as { name?: string } | undefined;
    assetSym = asDisplayString(baseAsset?.name) || 'POOL';
    const shares = getAmountStr(data.sharesRedeemed);
    const processed = (tx.processed as Record<string, unknown>) || {};
    const received = (processed.received as Record<string, unknown>) || {};
    const baseRecv = getAmountStr(received.base || received.asset);
    const quoteRecv = getAmountStr(received.quote || received.wart);
    incoming = true;
    if (baseRecv !== '0' || quoteRecv !== '0') {
      amt = `${baseRecv} ${assetSym} + ${quoteRecv} WART`;
      desc = `Withdrew ${shares} LP shares from ${assetSym} pool → received ${baseRecv} ${assetSym} + ${quoteRecv} WART`;
    } else {
      amt = shares;
      desc = `Withdrew ${shares} LP shares from ${assetSym} pool`;
    }
  } else if (cat.includes('assetcreation') || cat.includes('asset_creation')) {
    typ = 'asset_creation';
    assetSym = String(data.name || 'ASSET');
    amt = getAmountStr(data.supply);
    desc = `Created ${assetSym} (supply ${amt})`;
  } else if (cat.includes('match')) {
    typ = 'match';
    const baseAsset = data.baseAsset as { name?: string } | undefined;
    assetSym = baseAsset?.name || 'ASSET';
    const buySwaps = (data.buySwaps as Array<{ swapped?: Record<string, unknown> }>) || [];
    const sellSwaps = (data.sellSwaps as Array<{ swapped?: Record<string, unknown> }>) || [];
    const allSwaps = [...buySwaps, ...sellSwaps];
    const swapCount = allSwaps.length;
    const baseAmt = sumSwappedLeg(allSwaps, 'base');
    const quoteAmt = sumSwappedLeg(allSwaps, 'quote');
    amt = baseAmt || '0';
    desc = `DEX match${swapCount ? ` (${swapCount} swap${swapCount !== 1 ? 's' : ''})` : ''} on ${assetSym}`;
    if (baseAmt && quoteAmt) desc += ` — ${baseAmt} ${assetSym} / ${quoteAmt} WART`;
  } else if (cat.includes('cancel')) {
    typ = 'cancelation';
    desc = `Canceled tx ${abbreviate(data.cancelTxid)}`;
  } else {
    amt = getAmountStr(data.amount || data.supply);
    desc = cat || 'Transaction';
  }

  return {
    txid: hash,
    fromAddress: fromA,
    toAddress: toA,
    amount: amt,
    fee: getFeeStr(common.fee || item?.fee),
    confirmations: block?.confirmations,
    height: block?.height,
    timestamp: null,
    isReward: typ === 'reward',
    type: typ,
    asset: assetSym,
    description: desc,
    isIncoming: incoming,
    category: cat || typ,
  };
}

/** Normalize node body keys → filter-friendly type hints (snake-ish / camel both ok). */
function categoryHintFromKey(key: string): string {
  const lower = key.toLowerCase().replace(/-/g, '_');
  if (lower.includes('reward')) return 'reward';
  if (lower.includes('wart')) return 'wart_transfer';
  if (lower.includes('token')) return 'token_transfer';
  if (lower.includes('limit')) return 'limit_swap';
  if (lower.includes('liquiditydeposit') || lower === 'liquidity_deposit') {
    return 'liquidity_deposit';
  }
  if (lower.includes('liquiditywithdraw') || lower.includes('liquidity_withdraw')) {
    return 'liquidity_withdrawal';
  }
  if (lower.includes('asset')) return 'asset_creation';
  if (lower.includes('match')) return 'match';
  if (lower.includes('cancel')) return 'cancelation';
  return key;
}

export function parseHistoryBlocks(
  rawData: HistoryPayload,
  timestampMap: Record<number, number | undefined>,
  viewingAddress: string
): NormalizedHistoryTx[] {
  const newItems: NormalizedHistoryTx[] = [];
  if (!rawData.perBlock?.length) return newItems;

  rawData.perBlock.forEach((block) => {
    const h = block.height;
    const body = block.body || block.transactions || {};

    const rewardEntry = (body as Record<string, unknown>).reward;
    if (rewardEntry) {
      const list = Array.isArray(rewardEntry) ? rewardEntry : [rewardEntry];
      list.forEach((entry) => {
        if (entry) {
          const n = normalizeTransaction(entry, block, 'reward', viewingAddress);
          n.timestamp = block.header?.time?.timestamp || timestampMap[h ?? 0] || n.timestamp;
          newItems.push(n);
        }
      });
    }

    const defiKeys = [
      'wartTransfer', 'tokenTransfer', 'limitSwap', 'liquidityDeposit', 'liquidityWithdrawal',
      'assetCreation', 'match', 'cancelation',
      'wartTransfers', 'tokenTransfers', 'transfers', 'rewards',
    ];

    defiKeys.forEach((key) => {
      const arr = (body as Record<string, unknown>)[key];
      if (Array.isArray(arr)) {
        const hint = categoryHintFromKey(key);
        arr.forEach((entry) => {
          if (entry) {
            const n = normalizeTransaction(entry, block, hint, viewingAddress);
            n.timestamp = block.header?.time?.timestamp || timestampMap[h ?? 0] || n.timestamp;
            newItems.push(n);
          }
        });
      }
    });

    const legacyBody = body as { transfers?: unknown[]; rewards?: unknown[] };
    if (legacyBody.transfers?.length) {
      legacyBody.transfers.forEach((t) => {
        const n = normalizeTransaction(t, block, 'wartTransfer', viewingAddress);
        n.timestamp = block.header?.time?.timestamp || timestampMap[h ?? 0] || n.timestamp;
        if (!newItems.find((x) => x.txid === n.txid)) newItems.push(n);
      });
    }
    if (legacyBody.rewards?.length) {
      legacyBody.rewards.forEach((r) => {
        const n = normalizeTransaction(r, block, 'reward', viewingAddress);
        n.timestamp = block.header?.time?.timestamp || timestampMap[h ?? 0] || n.timestamp;
        newItems.push(n);
      });
    }
  });

  const seen = new Set<string>();
  return newItems.filter((it) => {
    if (seen.has(it.txid)) return false;
    seen.add(it.txid);
    return true;
  });
}

export async function fetchBlockTimestamps(
  node: string,
  perBlock: BlockEntry[]
): Promise<Record<number, number | undefined>> {
  const timestampMap: Record<number, number | undefined> = {};

  await Promise.allSettled(
    perBlock.map(async (block) => {
      if (block.height == null) return;
      if (block.header?.time?.timestamp) {
        timestampMap[block.height] = block.header.time.timestamp;
        return;
      }
      const url = `${node.replace(/\/$/, '')}/chain/block/${block.height}`;
      const response = await fetchWithTimeout(url, NODE_BLOCK_TIMEOUT_MS);
      if (!response.ok) return;
      const json = (await response.json()) as {
        code?: number;
        data?: { header?: { time?: { timestamp?: number } }; timestamp?: number };
      };
      if (json.code === 0) {
        const b = json.data;
        timestampMap[block.height] = b?.header?.time?.timestamp || b?.timestamp;
      }
    })
  );

  return timestampMap;
}

export type HistoryFetchResult = {
  items: NormalizedHistoryTx[];
  fromId: number | string | null;
  hasMore: boolean;
  source: 'indexer' | 'node';
  nextPage?: number;
};

function normalizeFromId(raw: unknown): number | string | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  // Keep non-numeric cursors if node ever returns them
  if (typeof raw === 'string' && raw.trim() && raw !== '0') return raw.trim();
  return null;
}

/** Node RPC history page (no type filter). Times out so a wedged node cannot spin forever. */
export async function fetchAccountHistory(
  node: string,
  address: string,
  beforeTxIndex: number | string = 4294967295
): Promise<HistoryFetchResult> {
  const url = `${node.replace(/\/$/, '')}/account/${address}/history/${beforeTxIndex}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, NODE_HISTORY_TIMEOUT_MS);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      aborted
        ? 'Node history timed out'
        : err instanceof Error
          ? err.message
          : 'Failed to fetch transaction history',
    );
  }
  if (!response.ok) {
    throw new Error(`Node history HTTP ${response.status}`);
  }
  const json = (await response.json()) as { code?: number; data?: HistoryPayload; error?: string };
  if (json.code !== 0) {
    throw new Error(json.error || 'Failed to fetch transaction history');
  }

  const rawData = json.data ?? {};
  if (!rawData.perBlock || !Array.isArray(rawData.perBlock)) {
    throw new Error('Unexpected response format from history endpoint');
  }

  const timestampMap = await fetchBlockTimestamps(node, rawData.perBlock);
  const items = parseHistoryBlocks(rawData, timestampMap, address);
  items.sort((a, b) => (b.height || 0) - (a.height || 0));

  const fromId = normalizeFromId(rawData.fromId);
  return {
    items,
    fromId,
    hasMore: items.length > 0 && fromId != null,
    source: 'node',
  };
}

/**
 * Prefer explorer indexer (server-side type filters like WartBunker).
 * Falls back to node RPC when indexer is unavailable.
 */
export async function fetchAccountHistoryPreferIndexer(
  node: string,
  address: string,
  options: {
    filter?: string;
    page?: number;
    beforeTxIndex?: number | string;
  } = {},
): Promise<HistoryFetchResult> {
  const filter = options.filter || 'all';
  const page = options.page ?? 1;

  try {
    const { fetchIndexerHistoryPage } = await import('./warthogIndexer');
    const indexed = await fetchIndexerHistoryPage(node, address, {
      page,
      filter,
    });
    if (indexed) {
      return {
        items: indexed.items,
        hasMore: indexed.hasMore,
        nextPage: indexed.nextPage,
        fromId: null,
        source: 'indexer',
      };
    }
  } catch (err) {
    console.warn('[history] indexer path failed, using node', err);
  }

  // Node path ignores type filter — caller must client-filter / hunt
  return fetchAccountHistory(node, address, options.beforeTxIndex ?? 4294967295);
}