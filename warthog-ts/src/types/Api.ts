import { TransactionContext } from './TransactionContext';
import type { TransactionJson } from './TransactionContext';
import { NonceId } from './NonceId';
import { RoundedFee } from './Funds';

/**
 * Known Warthog network nodes (prefer HTTPS public endpoints that stay online).
 */
export const KNOWN_NODES = [
    'https://warthognode.duckdns.org',
    'https://mainnet.wartnode.com',
    'https://warthog-defitestnet.duckdns.org',
    'https://testnet.wartnode.com',
] as const;

/**
 * Type representing a known node URL.
 */
export type NodeUrl = typeof KNOWN_NODES[number];

/**
 * Successful API response with data.
 */
export type ApiSuccess<T> = {
    success: true;
    data: T;
};

/**
 * Error response from API.
 */
export type ApiError = {
    success: false;
    code: number;
    error: string;
};

/**
 * Result type for API calls.
 */
export type ApiResult<T> = ApiSuccess<T> | ApiError;

/**
 * Pin fields used when signing transactions.
 */
export interface ChainPinFields {
    pinHash: string;
    pinHeight: number;
}

/**
 * Chain head payload — mainnet returns pin fields at the top level of `data`;
 * DeFi / newer nodes nest them under `data.chainHead`.
 */
export interface ChainHeadData {
    pinHash?: string;
    pinHeight?: number;
    height?: number;
    chainHead?: {
        pinHash?: string;
        pinHeight?: number;
        height?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Data returned after transaction submission.
 */
export interface SubmitTransactionData {
    txHash: string;
}

/**
 * Options for HTTP requests.
 */
export interface RequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    queryParams?: Record<string, string | number>;
}

/**
 * Normalize pin hash/height from either mainnet (flat) or DeFi (nested chainHead) shapes.
 */
export function normalizeChainPin(data: unknown): ChainPinFields {
    const root = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
    const nested =
        root.chainHead && typeof root.chainHead === 'object'
            ? (root.chainHead as Record<string, unknown>)
            : null;

    const pinHash = String(
        (nested?.pinHash ?? root.pinHash ?? '') || '',
    );
    const pinHeightRaw = nested?.pinHeight ?? nested?.height ?? root.pinHeight ?? root.height;
    const pinHeight = Number(pinHeightRaw);

    if (!pinHash || pinHash.length < 64 || !Number.isFinite(pinHeight)) {
        throw new Error('Invalid chain head: missing pinHash/pinHeight');
    }

    return { pinHash, pinHeight };
}

/**
 * Convert transaction JSON for wire submission (bigint → number).
 */
export function serializeForApi(tx: TransactionJson): TransactionJson {
    const replacer = (_key: string, value: unknown): unknown => {
        if (typeof value === 'bigint') {
            return Number(value);
        }
        return value;
    };
    return JSON.parse(JSON.stringify(tx, replacer)) as TransactionJson;
}

/**
 * Client for communicating with Warthog nodes.
 */
export class WarthogApi {
    /**
     * Create a new API client.
     * @param baseUrl - Base URL of the Warthog node
     */
    constructor(public readonly baseUrl: string) {}

    /**
     * Make an HTTP request to the API.
     * @param path - API endpoint path
     * @param options - Request options
     * @returns API result
     */
    async request<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> {
        let url = `${this.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

        if (options?.queryParams) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options.queryParams)) {
                params.append(key, String(value));
            }
            url += `?${params.toString()}`;
        }

        const replacer = (_key: string, value: unknown): unknown => {
            if (typeof value === 'bigint') {
                return Number(value);
            }
            return value;
        };

        const body = options?.body ? JSON.stringify(options.body, replacer) : undefined;

        let response: Response;
        try {
            response = await fetch(url, {
                method: options?.method || 'GET',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'network error';
            return {
                success: false,
                code: 0,
                error: `Network error contacting ${this.baseUrl}: ${message}`,
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

    /**
     * Get the current chain head (latest pinned block).
     */
    async getChainHead(): Promise<ApiResult<ChainHeadData>> {
        return this.request<ChainHeadData>('/chain/head');
    }

    /**
     * Submit a signed transaction to the API.
     */
    async submitTransaction(tx: TransactionJson): Promise<ApiResult<SubmitTransactionData>> {
        return this.request<SubmitTransactionData>('/transaction/add', {
            method: 'POST',
            body: serializeForApi(tx),
        });
    }

    /**
     * Mainnet account balance.
     */
    async getAccountBalance(address: string): Promise<ApiResult<Record<string, unknown>>> {
        return this.request(`/account/${address}/balance`);
    }

    /**
     * DeFi / testnet WART balance (total / locked / mempool).
     */
    async getAccountWartBalance(address: string): Promise<ApiResult<Record<string, unknown>>> {
        return this.request(`/account/${address}/wart_balance`);
    }

    /**
     * Account balance for a specific asset (DeFi).
     */
    async getAccountAssetBalance(
        address: string,
        assetHash: string,
    ): Promise<ApiResult<Record<string, unknown>>> {
        const hash = assetHash.replace(/^0x/i, '').toLowerCase();
        return this.request(`/account/${address}/balance/asset:${hash}`);
    }

    /**
     * All open limit orders for an account (DeFi).
     */
    async getOpenOrders(address: string): Promise<ApiResult<unknown>> {
        return this.request(`/account/${address}/open_orders`);
    }

    /**
     * Open limit orders for one asset (DeFi).
     */
    async getOpenOrdersForAsset(
        address: string,
        assetHash: string,
    ): Promise<ApiResult<unknown>> {
        const hash = assetHash.replace(/^0x/i, '').toLowerCase();
        return this.request(`/account/${address}/open_orders/${hash}`);
    }

    /**
     * Pending mempool transactions for an account.
     */
    async getAccountMempool(address: string): Promise<ApiResult<unknown>> {
        return this.request(`/account/${address}/mempool`);
    }

    /**
     * Search assets by name and/or hash prefix (DeFi).
     */
    async searchAssets(
        namePrefix: string,
        hashPrefix?: string,
    ): Promise<ApiResult<unknown>> {
        const queryParams: Record<string, string> = { namePrefix };
        if (hashPrefix) {
            queryParams.hashPrefix = hashPrefix;
        }
        return this.request('/asset/complete', { queryParams });
    }

    /**
     * Look up a single asset by 64-char hash (DeFi).
     */
    async lookupAsset(assetHash: string): Promise<ApiResult<Record<string, unknown>>> {
        const hash = assetHash.replace(/^0x/i, '').toLowerCase();
        return this.request(`/asset/lookup/${hash}`);
    }

    /**
     * DEX market / pool info for an asset (DeFi).
     */
    async getDexMarket(assetHash: string): Promise<ApiResult<Record<string, unknown>>> {
        const hash = assetHash.replace(/^0x/i, '').toLowerCase();
        return this.request(`/dex/market/${hash}`);
    }

    /**
     * Account history cursor page.
     */
    async getAccountHistory(account: string, cursor: number | string): Promise<ApiResult<unknown>> {
        return this.request(`/account/${account}/history/${cursor}`);
    }

    /**
     * Fetch a block by height.
     */
    async getBlock(height: number): Promise<ApiResult<Record<string, unknown>>> {
        return this.request(`/chain/block/${height}`);
    }

    /**
     * Generic node path helper.
     */
    async getNodePath(path: string): Promise<ApiResult<unknown>> {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        return this.request(normalized);
    }

    /**
     * Minimum fee — tries common paths (nodes differ).
     */
    async getMinFee(): Promise<ApiResult<{ minFee: { E8: number | string; str?: string } }>> {
        const paths = ['/transaction/minfee', '/tools/minfee', '/tools/min_fee'];
        let last: ApiResult<{ minFee: { E8: number | string; str?: string } }> | null = null;
        for (const path of paths) {
            const result = await this.request<{ minFee: { E8: number | string; str?: string } }>(path);
            if (result.success) {
                return result;
            }
            last = result;
        }
        return last ?? { success: false, code: 1, error: 'min fee endpoint unavailable' };
    }

    /**
     * Create a transaction context for building transactions.
     * Accepts both flat (mainnet) and nested (DeFi) chain head shapes.
     */
    async createTransactionContext(fee: RoundedFee, nonceId: NonceId): Promise<TransactionContext> {
        const headResult = await this.getChainHead();
        if (!headResult.success) {
            throw new Error(headResult.error);
        }
        const pin = normalizeChainPin(headResult.data);
        return new TransactionContext(pin, fee, nonceId);
    }
}
