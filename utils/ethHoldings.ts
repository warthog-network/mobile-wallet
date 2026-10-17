/** Ethereum mainnet balances for the phrase-derived account. */

import { ETH_RPC, ETH_USDT } from './ethTokens';

const RPC_TIMEOUT_MS = 12000;

export type EthAssetSymbol = 'ETH' | 'USDT';

export interface EthAssetBalance {
  symbol: EthAssetSymbol;
  /** Trimmed decimal string. Null when that call failed. */
  amount: string | null;
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Decimal string that never rounds up, so a Max button cannot exceed the balance. */
export function formatRawAmountFloor(raw: bigint, decimals: number, places = 6): string {
  if (raw <= 0n || decimals < 0 || places < 0) return '0';
  const displayScale = 10n ** BigInt(places);
  const units = decimals >= places
    ? raw / (10n ** BigInt(decimals - places))
    : raw * (10n ** BigInt(places - decimals));
  if (units === 0n) return '0';
  const whole = units / displayScale;
  const frac = (units % displayScale).toString().padStart(places, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Full decimal string, no grouping, so number-display settings can format it. */
export function rawToDecimal(raw: bigint, decimals: number): string {
  if (raw === 0n || decimals < 0) return '0';
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  if (decimals === 0) return `${negative ? '-' : ''}${abs.toString()}`;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Decimal string from an integer token balance. Rounds to `places` and trims trailing zeros. */
export function formatRawAmount(raw: bigint, decimals: number, places = 6, grouped = true): string {
  if (raw <= 0n || decimals < 0 || places < 0) return '0';
  const displayScale = 10n ** BigInt(places);
  const units = decimals >= places
    ? (raw + (10n ** BigInt(decimals - places)) / 2n) / (10n ** BigInt(decimals - places))
    : raw * (10n ** BigInt(places - decimals));
  if (units === 0n) return `<0.${'0'.repeat(Math.max(places - 1, 0))}1`;
  const whole = units / displayScale;
  const frac = (units % displayScale).toString().padStart(places, '0').replace(/0+$/, '');
  const wholeText = grouped
    ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : whole.toString();
  return frac ? `${wholeText}.${frac}` : wholeText;
}

function hexToBigInt(hex: string | undefined): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

async function rpc(method: string, params: unknown[]): Promise<string> {
  const response = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Ethereum RPC ${response.status}`);
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || 'Ethereum RPC error');
  if (body.result == null) throw new Error('Empty Ethereum RPC result');
  return body.result;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ethereum RPC timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readRaw(method: string, params: unknown[]): Promise<bigint> {
  const hex = await withTimeout(rpc(method, params), RPC_TIMEOUT_MS);
  return hexToBigInt(hex);
}

/** Native ETH and ERC-20 USDT on Ethereum mainnet. One failed call does not blank the other. */
export async function readEthereumHoldings(address: string, blockTag = 'latest'): Promise<EthAssetBalance[]> {
  if (!ADDRESS.test(address)) {
    return [
      { symbol: 'ETH', amount: null },
      { symbol: 'USDT', amount: null },
    ];
  }
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  const [eth, usdt] = await Promise.all([
    readRaw('eth_getBalance', [address, blockTag])
      .then((raw) => rawToDecimal(raw, 18))
      .catch(() => null),
    readRaw('eth_call', [{ to: ETH_USDT, data }, blockTag])
      .then((raw) => rawToDecimal(raw, 6))
      .catch(() => null),
  ]);
  return [
    { symbol: 'ETH', amount: eth },
    { symbol: 'USDT', amount: usdt },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read balances after a transaction is mined.
 * A public RPC can still be a block behind the node that returned the receipt, so this retries that block before falling back to latest.
 */
export async function readEthereumHoldingsConfirmed(
  address: string,
  blockNumber?: number,
): Promise<EthAssetBalance[]> {
  if (blockNumber == null || !Number.isFinite(blockNumber) || blockNumber < 0) {
    return readEthereumHoldings(address);
  }
  const tag = `0x${Math.floor(blockNumber).toString(16)}`;
  let partial: EthAssetBalance[] | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = await readEthereumHoldings(address, tag);
    if (next.every((row) => row.amount != null)) return next;
    if (next.some((row) => row.amount != null)) partial = next;
    await sleep(700 * (attempt + 1));
  }
  if (partial) return partial;
  return readEthereumHoldings(address);
}
