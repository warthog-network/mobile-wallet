import { TokenBalance } from 'warthog-ts';
import { nodeRequest } from './api';
import {
  formatAmountFromRaw,
  formatBalanceBreakdown,
  formatTokenBalance,
  hasPositiveBalance,
  normalizeAssetHash,
  parseDisplayAmount,
} from './warthogFormat';
import type { AssetBalance, LiquidityPosition, OpenOrdersByAsset } from '../types';

type NodePayload = Record<string, unknown>;

export async function getNodeData(node: string, path: string): Promise<{ code: number; data?: unknown; error?: string }> {
  const result = await nodeRequest(node, path.startsWith('/') ? path : `/${path}`);
  if (!result.success) {
    return { code: result.code ?? -1, error: result.error || 'Request failed' };
  }
  return { code: 0, data: result.data };
}

export async function fetchAssetBalanceForAddress(
  node: string,
  address: string,
  assetHash: string,
  assetName = ''
): Promise<AssetBalance> {
  const hash = normalizeAssetHash(assetHash);
  const res = await nodeRequest<NodePayload & {
    token?: { name?: string; decimals?: number };
    balance?: { total?: NodePayload; locked?: NodePayload; mempool?: NodePayload } | NodePayload;
  }>(node, `/account/${address}/balance/asset:${hash}`);
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch asset balance');
  }

  const parsed = TokenBalance.parse(res.data);
  if (parsed) {
    const decimals = parsed.decimals.decimals;
    const free = parsed.free();
    return {
      hash,
      name: assetName || parsed.name,
      balance: formatAmountFromRaw(parsed.total.amount, decimals),
      available: formatAmountFromRaw(free.amount, decimals),
      locked: formatAmountFromRaw(parsed.locked.amount, decimals),
      mempool: formatAmountFromRaw(parsed.mempool.amount, decimals),
      hasLocked: parsed.locked.amount + parsed.mempool.amount > 0n,
      decimals,
    };
  }

  const data = res.data as NodePayload & {
    token?: { name?: string; decimals?: number };
    balance?: { total?: NodePayload } | NodePayload;
  };

  const tokenInfo = data?.token || {};
  const totalPart = (data?.balance as { total?: NodePayload })?.total;
  const decimals = Number(
    tokenInfo.decimals ?? (totalPart as NodePayload | undefined)?.decimals ?? 8
  );
  const breakdown = formatBalanceBreakdown(data?.balance, {
    kind: 'token',
    decimals,
  });
  const finalName = assetName || tokenInfo.name || 'Unknown Asset';

  return {
    hash,
    name: finalName,
    balance: breakdown.total,
    available: breakdown.available,
    locked: breakdown.locked,
    mempool: breakdown.mempool,
    hasLocked: breakdown.hasLocked,
    decimals,
  };
}

export async function fetchLiquidityBalance(
  node: string,
  address: string,
  assetHash: string
): Promise<{ balance: string; name: string; decimals: number } | null> {
  const hash = normalizeAssetHash(assetHash);
  const res = await getNodeData(node, `account/${address}/balance/liquidity:${hash}`);
  if (res.code !== 0 || !res.data) return null;

  const data = res.data as NodePayload & {
    token?: { name?: string; decimals?: number };
    asset?: { name?: string; decimals?: number };
    balance?: { total?: NodePayload } | NodePayload;
  };

  const balanceInfo = (data.balance as { total?: NodePayload })?.total || data.balance || data;
  if (!hasPositiveBalance(balanceInfo as NodePayload)) return null;

  const tokenInfo = data.token || data.asset || {};
  const decimals = Number(tokenInfo.decimals ?? 8);
  return {
    balance: formatTokenBalance(balanceInfo as NodePayload, decimals),
    name: String(tokenInfo.name || 'Asset'),
    decimals,
  };
}

export function computePoolSpotPrice(marketData: NodePayload): number | null {
  const pool = (marketData.liquidityPool || marketData.liquidity) as NodePayload | undefined;
  if (!pool) return null;

  const wartStr = parseDisplayAmount(pool.wart || pool.WART, '0');
  const assetStr = parseDisplayAmount(pool.asset, '0');
  const wart = parseFloat(wartStr);
  const asset = parseFloat(assetStr);
  if (!Number.isFinite(wart) || !Number.isFinite(asset) || asset <= 0) return null;
  return wart / asset;
}

export async function fetchLiquidityPositions(
  node: string,
  address: string,
  assetHashes: string[],
  knownAssets: AssetBalance[] = []
): Promise<LiquidityPosition[]> {
  const uniqueHashes = [...new Set(assetHashes.map((h) => normalizeAssetHash(h)))];
  const positions = await Promise.all(
    uniqueHashes.map(async (hash) => {
      try {
        const [liquidityRes, marketRes] = await Promise.all([
          getNodeData(node, `account/${address}/balance/liquidity:${hash}`),
          getNodeData(node, `dex/market/${encodeURIComponent(hash)}`),
        ]);

        if (liquidityRes.code !== 0 || !liquidityRes.data) return null;

        const balanceData = liquidityRes.data as NodePayload & {
          token?: { name?: string; decimals?: number };
          asset?: { name?: string; decimals?: number };
          balance?: { total?: NodePayload } | NodePayload;
        };

        const tokenInfo = balanceData.token || balanceData.asset || {};
        const balanceInfo = (balanceData.balance as { total?: NodePayload })?.total || balanceData.balance || balanceData;
        if (!hasPositiveBalance(balanceInfo as NodePayload)) return null;

        const decimals = Number(tokenInfo.decimals ?? 8);
        const lpBalance = formatTokenBalance(balanceInfo as NodePayload, decimals);

        const market = marketRes.code === 0 ? (marketRes.data as NodePayload) : null;
        const baseAsset = (market?.baseAsset || market?.asset || {}) as NodePayload;
        const known = knownAssets.find((a) => a.hash.toLowerCase() === hash);
        const pool = (market?.liquidityPool || market?.liquidity || {}) as NodePayload;
        const assetName = String(baseAsset.name || tokenInfo.name || known?.name || 'Asset');

        return {
          hash,
          name: assetName,
          assetId: baseAsset.id != null ? Number(baseAsset.id) : undefined,
          decimals,
          lpBalance,
          poolWart: parseDisplayAmount(pool.wart || pool.WART),
          poolAsset: parseDisplayAmount(pool.asset || pool[assetName]),
        } as LiquidityPosition;
      } catch {
        return null;
      }
    })
  );

  return positions.filter((p): p is LiquidityPosition => p != null);
}

export async function fetchOpenOrders(node: string, address: string): Promise<OpenOrdersByAsset[]> {
  const res = await nodeRequest<unknown>(node, `/account/${address}/open_orders`);
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch open orders');
  }
  const data = res.data;
  if (!Array.isArray(data)) return [];
  return data as OpenOrdersByAsset[];
}

export async function lookupAssetInfo(node: string, assetHash: string) {
  const hash = normalizeAssetHash(assetHash);
  const res = await nodeRequest(node, `/asset/lookup/${hash}`);
  if (!res.success) {
    throw new Error(res.error || 'Asset not found');
  }
  return res.data;
}

export type AssetInfo = {
  hash?: string;
  assetHash?: string;
  id?: number;
  name?: string;
  decimals?: number;
  height?: number;
  totalSupply?: unknown;
  ownerAccountId?: number;
  groupId?: number;
  parentId?: number | null;
};

export type AssetSearchResult = {
  matches: AssetInfo[];
  namePrefix?: string;
  hashPrefix?: string;
};

export async function searchAssets(
  node: string,
  namePrefix = '',
  hashPrefix?: string
): Promise<AssetSearchResult> {
  const query: Record<string, string> = { namePrefix };
  if (hashPrefix) query.hashPrefix = hashPrefix;
  const res = await nodeRequest(node, '/asset/complete', query);
  if (!res.success) {
    throw new Error(res.error || 'Asset search failed');
  }

  const data = res.data as AssetSearchResult | AssetInfo[];
  if (Array.isArray(data)) {
    return { matches: data };
  }

  return {
    matches: data?.matches ?? [],
    namePrefix: data?.namePrefix,
    hashPrefix: data?.hashPrefix,
  };
}

export async function fetchDexMarket(node: string, assetHash: string) {
  const hash = normalizeAssetHash(assetHash);
  const res = await nodeRequest(node, `/dex/market/${hash}`);
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch DEX market');
  }
  return res.data;
}