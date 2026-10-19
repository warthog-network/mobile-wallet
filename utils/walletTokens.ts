/** Default tokens per network, plus tokens the user adds on this device. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { base58, base64 } from '@scure/base';
import { ethers } from 'ethers';
import { ETH_CHAIN_ID, ETH_RPC, ETH_USDC, ETH_USDT, ETH_WBTC } from './ethTokens';
import {
  HEMI_CHAIN_ID,
  HEMI_RPC,
  HEMI_TOKEN,
  HEMI_VUSD,
  HEMIBTC,
  JUP_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  USDT_MINT,
} from './networks/chains';
import { HEMI_USDT } from './networks/hemiSushi';
import { networkFetch } from './networks/http';
import { solanaRpc } from './networks/solana';

export type TokenNetwork = 'ethereum' | 'hemi' | 'solana';

export type WalletToken = {
  id: string;
  network: TokenNetwork;
  symbol: string;
  name: string;
  decimals: number;
  /** Contract or mint. Native rows use `native`. */
  address: string;
  native: boolean;
  custom?: boolean;
  /** Solana token program that owns the mint. Classic SPL when omitted. */
  program?: string;
};

const STORE_KEY = 'warthogAddedTokens';
const NATIVE = 'native';
const listeners = new Set<() => void>();

export function subscribeTokens(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function tokenId(network: TokenNetwork, address: string): string {
  return `${network}:${address.toLowerCase()}`;
}

function row(
  network: TokenNetwork,
  symbol: string,
  name: string,
  decimals: number,
  address: string,
  native = false,
): WalletToken {
  return {
    id: tokenId(network, native ? NATIVE : address),
    network,
    symbol,
    name,
    decimals,
    address: native ? NATIVE : address,
    native,
  };
}

/** The basic assets for each network. Hemi also keeps USDT because Sushi already swaps it. */
export const DEFAULT_TOKENS: WalletToken[] = [
  row('ethereum', 'ETH', 'Ether', 18, NATIVE, true),
  row('ethereum', 'USDC', 'USD Coin', 6, ETH_USDC),
  row('ethereum', 'USDT', 'Tether', 6, ETH_USDT),
  row('ethereum', 'WBTC', 'Wrapped Bitcoin', 8, ETH_WBTC),
  row('hemi', 'ETH', 'Hemi ETH', 18, NATIVE, true),
  row('hemi', 'hemiBTC', 'hemiBTC', 8, HEMIBTC),
  row('hemi', 'HEMI', 'HEMI', 18, HEMI_TOKEN),
  row('hemi', 'VUSD', 'VUSD', 18, HEMI_VUSD),
  row('hemi', 'USDT', 'Tether', 6, HEMI_USDT),
  row('solana', 'SOL', 'Solana', 9, NATIVE, true),
  row('solana', 'USDC', 'USD Coin', 6, USDC_MINT),
  row('solana', 'USDT', 'Tether', 6, USDT_MINT),
  row('solana', 'JUP', 'Jupiter', 6, JUP_MINT),
];

export function defaultsFor(network: TokenNetwork): WalletToken[] {
  return DEFAULT_TOKENS.filter((token) => token.network === network);
}

/** A known zero. An unread balance is not zero. */
export function isZeroBalance(amount: string | null | undefined): boolean {
  if (amount == null || amount.trim() === '') return false;
  const value = Number(amount);
  return Number.isFinite(value) && value === 0;
}

/**
 * Holdings show the chain's native coin even at zero.
 * Other coins stay in the swap list and hide here until the balance is not zero.
 */
export function showOnHoldings(token: { native: boolean }, amount: string | null | undefined): boolean {
  return token.native || !isZeroBalance(amount);
}

type StoredToken = {
  network: TokenNetwork;
  symbol: string;
  name: string;
  decimals: number;
  address: string;
  program?: string;
};

function isStored(value: unknown): value is StoredToken {
  if (!value || typeof value !== 'object') return false;
  const rowValue = value as StoredToken;
  return (rowValue.network === 'ethereum' || rowValue.network === 'hemi' || rowValue.network === 'solana')
    && typeof rowValue.symbol === 'string'
    && typeof rowValue.name === 'string'
    && typeof rowValue.decimals === 'number'
    && typeof rowValue.address === 'string';
}

async function readStored(): Promise<StoredToken[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStored) : [];
  } catch {
    return [];
  }
}

export async function readCustomTokens(network?: TokenNetwork): Promise<WalletToken[]> {
  const rows = await readStored();
  return rows
    .filter((item) => !network || item.network === network)
    .map((item) => ({
      id: tokenId(item.network, item.address),
      network: item.network,
      symbol: item.symbol,
      name: item.name,
      decimals: item.decimals,
      address: item.address,
      native: false,
      custom: true,
      program: item.program,
    }));
}

export async function tokensFor(network: TokenNetwork): Promise<WalletToken[]> {
  const custom = await readCustomTokens(network);
  const seen = new Set(defaultsFor(network).map((token) => token.id));
  return [...defaultsFor(network), ...custom.filter((token) => !seen.has(token.id))];
}

async function rpc(url: string, method: string, params: unknown[]): Promise<string> {
  const response = await networkFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (!response.ok || body.error || body.result == null) {
    throw new Error(body.error?.message || 'The network did not answer.');
  }
  return body.result;
}

function decodeText(data: string): string {
  if (!/^0x[0-9a-fA-F]*$/.test(data) || data === '0x') throw new Error('This contract has no token symbol.');
  if (data.length === 66) {
    const bytes = ethers.getBytes(data);
    const end = bytes.indexOf(0);
    const text = new TextDecoder().decode(end === -1 ? bytes : bytes.slice(0, end)).trim();
    if (!text) throw new Error('This contract has no token symbol.');
    return text;
  }
  const text = ethers.AbiCoder.defaultAbiCoder().decode(['string'], data)[0] as string;
  if (!text.trim()) throw new Error('This contract has no token symbol.');
  return text.trim();
}

function cleanSymbol(value: string): string {
  const text = value.trim();
  if (!/^[A-Za-z0-9.]{1,16}$/.test(text)) throw new Error('This token symbol cannot be shown.');
  return text;
}

async function lookupEvm(network: 'ethereum' | 'hemi', address: string): Promise<WalletToken> {
  const checksum = ethers.getAddress(address);
  const url = network === 'ethereum' ? ETH_RPC : HEMI_RPC;
  const chainId = network === 'ethereum' ? ETH_CHAIN_ID : HEMI_CHAIN_ID;
  const live = await rpc(url, 'eth_chainId', []);
  if (BigInt(live) !== BigInt(chainId)) throw new Error('That network did not answer as mainnet.');
  const [decimalsHex, symbolHex, nameHex] = await Promise.all([
    rpc(url, 'eth_call', [{ to: checksum, data: '0x313ce567' }, 'latest']),
    rpc(url, 'eth_call', [{ to: checksum, data: '0x95d89b41' }, 'latest']),
    rpc(url, 'eth_call', [{ to: checksum, data: '0x06fdde03' }, 'latest']).catch(() => '0x'),
  ]);
  const decimals = Number(BigInt(decimalsHex));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('This token uses an unsupported decimal count.');
  }
  let name = checksum;
  try {
    if (nameHex !== '0x') name = decodeText(nameHex).slice(0, 48);
  } catch {
    name = checksum;
  }
  return {
    id: tokenId(network, checksum),
    network,
    symbol: cleanSymbol(decodeText(symbolHex)),
    name,
    decimals,
    address: checksum,
    native: false,
    custom: true,
  };
}

async function lookupSolana(mint: string): Promise<WalletToken> {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(mint);
  } catch {
    throw new Error('Enter a Solana mint address.');
  }
  if (bytes.length !== 32) throw new Error('Enter a Solana mint address.');
  const info = await solanaRpc<{ value: { owner: string; data: [string, string] } | null }>(
    'getAccountInfo',
    [mint, { encoding: 'base64' }],
  );
  const account = info.value;
  if (!account) throw new Error('That mint does not exist on Solana.');
  if (account.owner !== TOKEN_PROGRAM_ID && account.owner !== TOKEN_2022_PROGRAM_ID) {
    throw new Error('That address is not a Solana token mint.');
  }
  const raw = base64.decode(account.data[0]);
  if (raw.length < 45) throw new Error('That address is not a Solana token mint.');
  const decimals = raw[44];
  if (decimals > 18) throw new Error('This token uses an unsupported decimal count.');
  let symbol = `${mint.slice(0, 4)}…`;
  let name = 'Added token';
  try {
    const response = await networkFetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`);
    const body = await response.json() as { symbol?: string; name?: string }[] | { symbol?: string; name?: string };
    const hit = Array.isArray(body) ? body.find((item) => item && typeof item === 'object') : body;
    if (hit && typeof hit.symbol === 'string') symbol = cleanSymbol(hit.symbol);
    if (hit && typeof hit.name === 'string' && hit.name.trim()) name = hit.name.trim().slice(0, 48);
  } catch {
    // The mint is real. A missing list only means the short symbol stays.
  }
  return {
    id: tokenId('solana', mint),
    network: 'solana',
    symbol,
    name,
    decimals,
    address: mint,
    native: false,
    custom: true,
    program: account.owner,
  };
}

/** Read the symbol and decimals from the chain, then keep the token on this device. */
export async function addCustomToken(network: TokenNetwork, address: string): Promise<WalletToken> {
  const text = address.trim();
  const token = network === 'solana' ? await lookupSolana(text) : await lookupEvm(network, text);
  const defaults = defaultsFor(network);
  if (defaults.some((item) => item.id === token.id || item.address.toLowerCase() === token.address.toLowerCase())) {
    throw new Error(`${token.symbol} is already on this network.`);
  }
  const stored = await readStored();
  if (stored.some((item) => item.network === network && item.address.toLowerCase() === token.address.toLowerCase())) {
    throw new Error(`${token.symbol} is already added.`);
  }
  const next: StoredToken = {
    network,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    address: token.address,
    program: token.program,
  };
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify([next, ...stored].slice(0, 40)));
  emit();
  return token;
}

export async function removeCustomToken(network: TokenNetwork, address: string): Promise<void> {
  const stored = await readStored();
  const next = stored.filter((item) => !(item.network === network && item.address.toLowerCase() === address.toLowerCase()));
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
  emit();
}
