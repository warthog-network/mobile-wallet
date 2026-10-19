import CryptoJS from 'crypto-js';
import { Platform } from 'react-native';
import { SECURE_STORE_KEYS } from '../../constants';
import { storage } from '../storage';
import { ExchangeError, requestJson } from './http';

const ROOT = 'https://safe.trade/api/v2';
const MARKET = 'wartusdt';

/** wartusdt amount_precision, total_precision, and min_amount from the public market. */
export const WART_USDT_MARKET = {
  minWart: 0.01,
  amountPlaces: 4,
  totalPlaces: 4,
};

/** Enabled SafeTrade markets for coins this wallet can hold. Precision is from the public markets list. */
export type SafeMarket = {
  id: string;
  base: string;
  quote: string;
  amountPlaces: number;
  pricePlaces: number;
  totalPlaces: number;
  minBase: number;
};

export const SAFE_MARKETS: SafeMarket[] = [
  { id: 'wartusdt', base: 'wart', quote: 'usdt', amountPlaces: 4, pricePlaces: 4, totalPlaces: 4, minBase: 0.01 },
  { id: 'btcusdt', base: 'btc', quote: 'usdt', amountPlaces: 8, pricePlaces: 1, totalPlaces: 4, minBase: 0.00001 },
  { id: 'ethusdt', base: 'eth', quote: 'usdt', amountPlaces: 3, pricePlaces: 2, totalPlaces: 4, minBase: 0.00001 },
  { id: 'ethbtc', base: 'eth', quote: 'btc', amountPlaces: 4, pricePlaces: 6, totalPlaces: 4, minBase: 0.0001 },
  { id: 'solbtc', base: 'sol', quote: 'btc', amountPlaces: 2, pricePlaces: 8, totalPlaces: 4, minBase: 0.1 },
  { id: 'usdcusdt', base: 'usdc', quote: 'usdt', amountPlaces: 4, pricePlaces: 5, totalPlaces: 4, minBase: 1 },
];

export type SafeChain = 'wart' | 'ethereum' | 'bitcoin' | 'solana';

/**
 * Deposit and withdraw networks that match a chain this wallet holds.
 * Hemi is absent because SafeTrade lists no Hemi network.
 * Base, BSC, Arbitrum, Tron, Avalanche, and Polygon are listed for some coins
 * and are absent here because this wallet has no account on those chains.
 */
export type SafeRoute = {
  id: string;
  currency: string;
  symbol: string;
  chain: SafeChain;
  network: string;
  blockchainKey: string;
  /** This wallet can sign a deposit. SafeTrade can still have deposits turned off. */
  canDeposit: boolean;
  minDeposit: number;
  minWithdraw: number;
  fee: number;
  confirmations: number;
  decimals: number;
};

export const SAFE_ROUTES: SafeRoute[] = [
  { id: 'wart:wart-key', currency: 'wart', symbol: 'WART', chain: 'wart', network: 'Warthog', blockchainKey: 'wart-key', canDeposit: true, minDeposit: 20, minWithdraw: 5, fee: 0.1, confirmations: 100, decimals: 8 },
  { id: 'btc:bitcoin-key', currency: 'btc', symbol: 'BTC', chain: 'bitcoin', network: 'Bitcoin', blockchainKey: 'bitcoin-key', canDeposit: true, minDeposit: 0.0001, minWithdraw: 0.001, fee: 0.0001, confirmations: 1, decimals: 8 },
  { id: 'eth:erc20_key', currency: 'eth', symbol: 'ETH', chain: 'ethereum', network: 'Ethereum', blockchainKey: 'erc20_key', canDeposit: true, minDeposit: 0.01, minWithdraw: 0.01, fee: 0.004, confirmations: 7, decimals: 8 },
  { id: 'usdt:erc20_key', currency: 'usdt', symbol: 'USDT', chain: 'ethereum', network: 'Ethereum', blockchainKey: 'erc20_key', canDeposit: true, minDeposit: 50, minWithdraw: 50, fee: 3, confirmations: 7, decimals: 6 },
  { id: 'usdc:erc20_key', currency: 'usdc', symbol: 'USDC', chain: 'ethereum', network: 'Ethereum', blockchainKey: 'erc20_key', canDeposit: false, minDeposit: 50, minWithdraw: 50, fee: 7, confirmations: 7, decimals: 6 },
  { id: 'sol:spl-key', currency: 'sol', symbol: 'SOL', chain: 'solana', network: 'Solana', blockchainKey: 'spl-key', canDeposit: true, minDeposit: 0.005, minWithdraw: 0.01, fee: 0.009, confirmations: 32, decimals: 8 },
  { id: 'usdt:spl-key', currency: 'usdt', symbol: 'USDT', chain: 'solana', network: 'Solana', blockchainKey: 'spl-key', canDeposit: false, minDeposit: 0.01, minWithdraw: 2, fee: 1, confirmations: 32, decimals: 6 },
  { id: 'usdc:spl-key', currency: 'usdc', symbol: 'USDC', chain: 'solana', network: 'Solana', blockchainKey: 'spl-key', canDeposit: false, minDeposit: 0.001, minWithdraw: 1, fee: 3, confirmations: 32, decimals: 6 },
];

/** Direct market for two SafeTrade currencies. Null when the pair is not listed. */
export function safePair(
  pay: string,
  receive: string,
): { market: SafeMarket; side: 'buy' | 'sell' } | null {
  const market = SAFE_MARKETS.find((row) => (
    (row.base === pay && row.quote === receive) || (row.base === receive && row.quote === pay)
  ));
  if (!market || pay === receive) return null;
  return { market, side: market.base === pay ? 'sell' : 'buy' };
}

export type SafeTradeCredentials = {
  apiKey: string;
  secret: string;
};

type StoredExchangeKeys = {
  safetrade?: { apiKey?: string; secret?: string };
  tidoex?: { apiKey?: string };
};

export type SpotBalance = {
  asset: string;
  available: number;
  locked: number;
};

export type SafeTicker = {
  market: string;
  last: string;
  change: string;
};

let lastNonce = 0;

function nextNonce(): string {
  const now = Date.now();
  lastNonce = now > lastNonce ? now : lastNonce + 1;
  return String(lastNonce);
}

function sign(apiKey: string, secret: string, nonce: string): string {
  return CryptoJS.HmacSHA256(nonce + apiKey, secret).toString(CryptoJS.enc.Hex);
}

async function readStored(): Promise<StoredExchangeKeys> {
  const raw = await storage.getItemAsync(SECURE_STORE_KEYS.exchangeKeys);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredExchangeKeys;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function keyHint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return 'saved';
  return `····${trimmed.slice(-4)}`;
}

export async function loadSafeTradeCredentials(): Promise<SafeTradeCredentials | null> {
  const parsed = await readStored();
  const apiKey = parsed.safetrade?.apiKey?.trim() ?? '';
  const secret = parsed.safetrade?.secret?.trim() ?? '';
  if (!apiKey || !secret) return null;
  return { apiKey, secret };
}

export async function saveSafeTradeCredentials(next: SafeTradeCredentials): Promise<void> {
  const apiKey = next.apiKey.trim();
  const secret = next.secret.trim();
  if (!apiKey || !secret) {
    throw new ExchangeError('Enter both the SafeTrade API key and the secret.', 0, null);
  }
  const existing = await readStored();
  const cleaned: StoredExchangeKeys = {
    ...existing,
    safetrade: { apiKey, secret },
  };
  await storage.setItemAsync(SECURE_STORE_KEYS.exchangeKeys, JSON.stringify(cleaned));
}

export async function clearSafeTradeCredentials(): Promise<void> {
  const existing = await readStored();
  const rest: StoredExchangeKeys = { ...existing };
  delete rest.safetrade;
  if (!rest.tidoex?.apiKey) {
    await storage.deleteItemAsync(SECURE_STORE_KEYS.exchangeKeys);
    return;
  }
  await storage.setItemAsync(SECURE_STORE_KEYS.exchangeKeys, JSON.stringify(rest));
}

async function call(
  creds: SafeTradeCredentials | null,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (creds) {
    const nonce = nextNonce();
    headers['X-Auth-Apikey'] = creds.apiKey;
    headers['X-Auth-Nonce'] = nonce;
    headers['X-Auth-Signature'] = sign(creds.apiKey, creds.secret, nonce);
  }
  const method = init?.method ?? 'GET';
  return requestJson(endpoint(path, Boolean(creds)), {
    method,
    headers,
    body: init?.body == null ? undefined : JSON.stringify(init.body),
  });
}

function floorDecimals(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.floor(value * factor + 1e-9) / factor;
}

/** Signed web calls go through the dev server. safe.trade rejects those headers from a page. */
function endpoint(path: string, signed: boolean): string {
  if (
    signed
    && Platform.OS === 'web'
    && typeof window !== 'undefined'
    && window.location?.origin
  ) {
    return `${window.location.origin}/safetrade-proxy${path}`;
  }
  return `${ROOT}${path}`;
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function safeTicker(marketId = MARKET): Promise<SafeTicker> {
  const body = await call(null, `/trade/public/tickers/${marketId}`);
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const last = rec.last != null ? String(rec.last) : '';
  const known = SAFE_MARKETS.find((row) => row.id === marketId);
  const name = known ? `${known.base.toUpperCase()}/${known.quote.toUpperCase()}` : marketId.toUpperCase();
  if (!last) {
    throw new ExchangeError(`SafeTrade did not return a ${name} price.`, 0, body);
  }
  return {
    market: name,
    last,
    change: rec.price_change_percent != null ? String(rec.price_change_percent) : '',
  };
}

export type SafeOrder = {
  id: string;
  state: string;
  filled: number;
  averagePrice: number;
  origin: number;
};

export type WartWithdrawResult =
  | { needCode: true; message: string; clearEmail?: boolean }
  | { id: string; status: string; txid: string; amount: number; fee: number };

export type SafeCoin = {
  currency: string;
  blockchainKey: string;
  min: number;
  fee: number;
  decimals: number;
  bookLabel: string;
};

export const WART_WITHDRAW: SafeCoin = {
  currency: 'wart',
  blockchainKey: 'wart-key',
  min: 5,
  fee: 0.1,
  decimals: 8,
  bookLabel: 'This wallet',
};

/** Ethereum USDT on SafeTrade. Other wallet networks are SAFE_ROUTES. */
export const USDT_ETH: SafeCoin = {
  currency: 'usdt',
  blockchainKey: 'erc20_key',
  min: 50,
  fee: 3,
  decimals: 6,
  bookLabel: 'This wallet ETH',
};

export const WART_DEPOSIT = { min: 20, confirmations: 100, blockchainKey: 'wart-key' };
export const USDT_DEPOSIT = { min: 50, confirmations: 7, blockchainKey: 'erc20_key' };

const ORDER_DONE = new Set(['done', 'cancel', 'canceled', 'cancelled', 'reject', 'rejected']);

function readOrder(body: unknown): SafeOrder {
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    id: String(rec.id ?? ''),
    state: String(rec.state ?? '').toLowerCase(),
    filled: asNumber(rec.filled_amount),
    averagePrice: asNumber(rec.avg_price ?? rec.price),
    origin: asNumber(rec.origin_amount),
  };
}

/** Market trade of a free SafeTrade balance. Buy spends the quote. Sell spends the base. */
export async function safeSwap(
  creds: SafeTradeCredentials,
  input: { market: SafeMarket; side: 'buy' | 'sell'; amount: number },
): Promise<SafeOrder> {
  const { market, side } = input;
  if (side === 'sell') {
    const amount = floorDecimals(input.amount, market.amountPlaces);
    if (amount < market.minBase) {
      throw new ExchangeError(`Minimum ${market.base.toUpperCase()} sell is ${market.minBase}.`, 0, null);
    }
    const body = await call(creds, '/trade/market/orders', {
      method: 'POST',
      body: { market: market.id, side: 'sell', type: 'market', amount },
    });
    return readOrder(body);
  }
  const total = floorDecimals(input.amount, market.totalPlaces);
  if (!(total > 0)) throw new ExchangeError('Enter an amount.', 0, null);
  try {
    const body = await call(creds, '/trade/market/orders', {
      method: 'POST',
      body: { market: market.id, side: 'buy', type: 'market_quote', total },
    });
    return readOrder(body);
  } catch (err) {
    if (!(err instanceof ExchangeError) || (err.status !== 400 && err.status !== 422)) throw err;
    const quote = await safeTicker(market.id);
    const last = Number(quote.last);
    if (!(last > 0)) throw err;
    const body = await call(creds, '/trade/market/orders', {
      method: 'POST',
      body: {
        market: market.id,
        side: 'buy',
        type: 'market',
        amount: floorDecimals(total / last, market.amountPlaces),
        max_price: floorDecimals(last * 1.01, market.pricePlaces),
      },
    });
    return readOrder(body);
  }
}

/** Spend USDT already on SafeTrade to buy WART at the market. */
export async function safeBuyWart(creds: SafeTradeCredentials, usdtTotal: number): Promise<SafeOrder> {
  const pair = safePair('usdt', 'wart');
  if (!pair) throw new ExchangeError('SafeTrade has no WART/USDT market.', 0, null);
  return safeSwap(creds, { ...pair, amount: usdtTotal });
}

/** Sell WART already on SafeTrade for USDT at the market. */
export async function safeSellWart(creds: SafeTradeCredentials, wartAmount: number): Promise<SafeOrder> {
  const pair = safePair('wart', 'usdt');
  if (!pair) throw new ExchangeError('SafeTrade has no WART/USDT market.', 0, null);
  return safeSwap(creds, { ...pair, amount: wartAmount });
}

export async function safeWaitOrder(creds: SafeTradeCredentials, orderId: string): Promise<SafeOrder> {
  let latest: SafeOrder = { id: orderId, state: 'wait', filled: 0, averagePrice: 0, origin: 0 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const body = await call(creds, `/trade/market/orders/${orderId}`);
    latest = readOrder(body);
    if (ORDER_DONE.has(latest.state)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return latest;
}

function recordList(body: unknown): Record<string, unknown>[] {
  const rows = (value: unknown) => (
    Array.isArray(value)
      ? value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
      : []
  );
  const direct = rows(body);
  if (direct.length || Array.isArray(body)) return direct;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    for (const key of ['data', 'beneficiaries', 'records']) {
      const nested = rows(rec[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function beneficiaryDestination(row: Record<string, unknown>): string {
  const data = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : null;
  const nested = row.beneficiary && typeof row.beneficiary === 'object'
    ? row.beneficiary as Record<string, unknown>
    : null;
  const raw = row.address ?? row.rid ?? data?.address ?? nested?.address ?? '';
  return String(raw).split('?memo=')[0].trim().toLowerCase();
}

function sameCoinAddress(row: Record<string, unknown>, address: string, blockchainKey: string): boolean {
  const chain = String(row.blockchain_key ?? '');
  return beneficiaryDestination(row) === address.toLowerCase()
    && (chain === '' || chain === blockchainKey);
}

function usableBeneficiary(row: Record<string, unknown>): boolean {
  const state = String(row.state ?? 'active').toLowerCase();
  return state !== 'pending' && state !== 'disabled' && state !== 'archived';
}

async function listCoinBeneficiaries(
  creds: SafeTradeCredentials,
  currency: string,
): Promise<Record<string, unknown>[]> {
  return recordList(await call(
    creds,
    `/trade/account/beneficiaries?currency_id=${encodeURIComponent(currency)}&limit=100`,
  ));
}

export type WartAddressBook = 'saved' | 'pending' | 'missing';

/** Whether this address is on the SafeTrade withdraw list for that coin and network. */
export async function safeCoinAddressBook(
  creds: SafeTradeCredentials,
  coin: SafeCoin,
  address: string,
): Promise<WartAddressBook> {
  const trimmed = address.trim();
  if (!trimmed) return 'missing';
  const matches = (await listCoinBeneficiaries(creds, coin.currency))
    .filter((row) => sameCoinAddress(row, trimmed, coin.blockchainKey));
  if (matches.some(usableBeneficiary)) return 'saved';
  if (matches.some((row) => String(row.state ?? '').toLowerCase() === 'pending')) return 'pending';
  return 'missing';
}

export function safeWartAddressBook(
  creds: SafeTradeCredentials,
  address: string,
): Promise<WartAddressBook> {
  return safeCoinAddressBook(creds, WART_WITHDRAW, address);
}

async function postCoinWithdraw(
  creds: SafeTradeCredentials,
  coin: SafeCoin,
  payload: Record<string, unknown>,
  options?: { includeChain?: boolean },
): Promise<WartWithdrawResult> {
  const includeChain = options?.includeChain !== false;
  const send = async (amount: number) => call(creds, '/trade/account/withdraws', {
    method: 'POST',
    body: {
      ...payload,
      amount,
      currency: coin.currency,
      ...(includeChain ? { blockchain_key: coin.blockchainKey } : {}),
    },
  });
  const amount = asNumber(payload.amount);
  try {
    return readWithdraw(await send(amount));
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const reduced = floorDecimals(amount - coin.fee, coin.decimals);
    if (!/insufficient|fee/i.test(message) || reduced < coin.min) throw err;
    return readWithdraw(await send(reduced));
  }
}

function readWithdraw(body: unknown): WartWithdrawResult {
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    id: String(rec.id ?? ''),
    status: String(rec.status ?? rec.state ?? ''),
    txid: rec.txid != null ? String(rec.txid) : '',
    amount: asNumber(rec.amount),
    fee: asNumber(rec.fee),
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

function readBeneficiaryId(body: unknown): number {
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nested = rec.data && typeof rec.data === 'object' ? rec.data as Record<string, unknown> : null;
  return asNumber(rec.id ?? nested?.id);
}

function readBeneficiaryState(body: unknown): string {
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nested = rec.data && typeof rec.data === 'object' ? rec.data as Record<string, unknown> : null;
  return String(rec.state ?? nested?.state ?? '').toLowerCase();
}

/** SafeTrade emails a code that adds the address to the address book. A raw address is rejected. */
async function sendAddressBookCode(
  creds: SafeTradeCredentials,
  coin: SafeCoin,
  address: string,
): Promise<void> {
  await call(creds, '/trade/account/beneficiaries/generate_code', {
    method: 'POST',
    body: {
      type: 'email',
      currency_id: coin.currency,
      blockchain_key: coin.blockchainKey,
      data: { address },
    },
  });
}

/**
 * Withdraw a coin to an address.
 * SafeTrade returns account.withdraw.address_not_found unless that address is
 * already an active address-book entry, so this saves the address first.
 */
export async function safeWithdrawCoin(
  creds: SafeTradeCredentials,
  coin: SafeCoin,
  input: { amount: number; address: string; emailCode?: string; otpCode?: string },
): Promise<WartWithdrawResult> {
  const asset = coin.currency.toUpperCase();
  const amount = floorDecimals(input.amount, coin.decimals);
  const address = input.address.trim();
  if (!(amount >= coin.min)) {
    throw new ExchangeError(`Minimum ${asset} withdraw is ${coin.min}.`, 0, null);
  }
  if (!address) throw new ExchangeError(`This wallet has no ${asset} address to withdraw to.`, 0, null);
  const emailCode = input.emailCode?.trim() ?? '';
  const otpCode = input.otpCode?.trim() ?? '';
  const listed = await listCoinBeneficiaries(creds, coin.currency);
  const matches = listed.filter((row) => sameCoinAddress(row, address, coin.blockchainKey));
  const active = matches.find(usableBeneficiary);
  if (active) {
    const beneficiaryId = asNumber(active.id);
    if (!(beneficiaryId > 0)) {
      throw new ExchangeError('SafeTrade listed this address without an id.', 0, active);
    }
    try {
      return await postCoinWithdraw(creds, coin, {
        amount,
        beneficiary_id: beneficiaryId,
        ...(otpCode ? { otp_code: otpCode } : {}),
      }, { includeChain: false });
    } catch (err) {
      if (/missing_otp|invalid_otp|otp/i.test(errorText(err))) {
        return {
          needCode: true,
          message: 'This address is already saved. Enter the 2FA code from your authenticator, then tap withdraw again.',
        };
      }
      throw err;
    }
  }
  if (matches.some((row) => String(row.state ?? '').toLowerCase() === 'pending')) {
    throw new ExchangeError(
      'SafeTrade has this address saved but it is not active yet. Confirm it in the SafeTrade address book, then tap withdraw again.',
      0,
      null,
    );
  }
  if (!emailCode) {
    await sendAddressBookCode(creds, coin, address);
    return {
      needCode: true,
      message: `SafeTrade will not send ${asset} until this address is in your address book. A code is in your email. Enter that code and your 2FA code, then tap withdraw again. Nothing is sent until that succeeds.`,
    };
  }
  if (!otpCode) {
    return {
      needCode: true,
      message: 'SafeTrade refused this address because it is not in your address book. Enter your 2FA code and tap again to save it. If that email code was from the last attempt, clear it first so a code for the address book can be sent.',
    };
  }
  let created: unknown;
  try {
    created = await call(creds, '/trade/account/beneficiaries', {
      method: 'POST',
      body: {
        label: coin.bookLabel,
        currency_id: coin.currency,
        blockchain_key: coin.blockchainKey,
        email_code: emailCode,
        otp_code: otpCode,
        data: { address },
      },
    });
  } catch (err) {
    const message = errorText(err);
    if (/2fa_disabled/i.test(message)) {
      throw new ExchangeError(
        'SafeTrade requires 2FA on the account before it will save a withdrawal address. Turn on 2FA in SafeTrade, then try again.',
        err instanceof ExchangeError ? err.status : 0,
        err instanceof ExchangeError ? err.body : null,
      );
    }
    if (/invalid_code|missing_email_code/i.test(message)) {
      await sendAddressBookCode(creds, coin, address);
      return {
        needCode: true,
        clearEmail: true,
        message: 'That email code cannot save this address. SafeTrade sent a new one. Enter the new code and your 2FA code, then tap withdraw again.',
      };
    }
    if (/invalid_otp|missing_otp/i.test(message)) {
      return {
        needCode: true,
        message: 'SafeTrade rejected the 2FA code. Enter the current authenticator code and tap withdraw again.',
      };
    }
    if (/already|duplicate|taken/i.test(message)) {
      const again = await listCoinBeneficiaries(creds, coin.currency);
      const saved = again.find((row) => (
        sameCoinAddress(row, address, coin.blockchainKey)
        && String(row.state ?? 'active').toLowerCase() === 'active'
      ));
      if (saved && asNumber(saved.id) > 0) {
        return postCoinWithdraw(creds, coin, {
          amount,
          beneficiary_id: asNumber(saved.id),
          otp_code: otpCode,
        }, { includeChain: false });
      }
    }
    throw err;
  }
  const beneficiaryId = readBeneficiaryId(created);
  const state = readBeneficiaryState(created);
  if (state === 'pending' || !(beneficiaryId > 0)) {
    return {
      needCode: true,
      message: 'SafeTrade saved this address, but it is not active yet. Confirm it in the SafeTrade address book, then tap withdraw again.',
    };
  }
  try {
    return await postCoinWithdraw(creds, coin, {
      amount,
      beneficiary_id: beneficiaryId,
      otp_code: otpCode,
    }, { includeChain: false });
  } catch (err) {
    if (/invalid_otp|missing_otp/i.test(errorText(err))) {
      return {
        needCode: true,
        message: 'This address is saved in the SafeTrade address book. Enter a new 2FA code and tap withdraw again.',
      };
    }
    throw err;
  }
}

export function safeWithdrawWart(
  creds: SafeTradeCredentials,
  input: { amount: number; address: string; emailCode?: string; otpCode?: string },
): Promise<WartWithdrawResult> {
  return safeWithdrawCoin(creds, WART_WITHDRAW, input);
}

export type SafeNetworkLimits = {
  minDeposit: number;
  minWithdraw: number;
  fee: number;
  confirmations: number;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
};

/** Public network rules. Returns null when SafeTrade cannot be read. */
export async function safePublicNetwork(
  currency: string,
  blockchainKey: string,
): Promise<SafeNetworkLimits | null> {
  try {
    const body = await call(null, `/trade/public/currencies/${encodeURIComponent(currency)}`);
    const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const networks = Array.isArray(rec.networks) ? rec.networks : [];
    const network = networks.find((row) => (
      row && typeof row === 'object'
      && String((row as Record<string, unknown>).blockchain_key ?? '') === blockchainKey
    )) as Record<string, unknown> | undefined;
    if (!network) return null;
    return {
      minDeposit: asNumber(network.min_deposit_amount),
      minWithdraw: asNumber(network.min_withdraw_amount),
      fee: asNumber(network.withdraw_fee),
      confirmations: asNumber(network.min_confirmations),
      depositEnabled: network.deposit_enabled !== false && String(network.status ?? 'active') !== 'disabled',
      withdrawEnabled: network.withdraw_enabled !== false && String(network.status ?? 'active') !== 'disabled',
    };
  } catch {
    return null;
  }
}

/** Signed deposit address for one SafeTrade network. */
export async function safeDepositAddress(
  creds: SafeTradeCredentials,
  currency: string,
  blockchainKey: string,
): Promise<string> {
  const body = await call(
    creds,
    `/trade/account/deposit_address/${currency}?network=${encodeURIComponent(blockchainKey)}`,
  );
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nested = rec.data && typeof rec.data === 'object' ? rec.data as Record<string, unknown> : null;
  const address = String(rec.address ?? nested?.address ?? '').split('?memo=')[0].trim();
  if (!address) throw new ExchangeError('SafeTrade did not return a deposit address.', 0, body);
  return address;
}

export async function safeBalances(creds: SafeTradeCredentials): Promise<SpotBalance[]> {
  const body = await call(creds, '/trade/account/balances/spot');
  if (!Array.isArray(body)) {
    throw new ExchangeError('SafeTrade did not return balances.', 0, body);
  }
  return body.map((row) => {
    const rec = row as Record<string, unknown>;
    return {
      asset: String(rec.currency ?? rec.asset ?? '').toUpperCase(),
      available: asNumber(rec.balance ?? rec.available),
      locked: asNumber(rec.locked),
    };
  });
}
