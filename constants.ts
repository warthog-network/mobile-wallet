// constants.ts - App-wide constants

export const WARTHOG_NODES = [
  'https://warthognode.duckdns.org',
  'http://217.182.64.43:3001',
] as const;

export type NodeUrl = typeof WARTHOG_NODES[number];

export const DERIVATION_PATHS = {
  hardened: "m/44'/2070'/0'/0/0",
  normal: "m/44'/2070'/0/0/0",
} as const;

export const SECURE_STORE_KEYS = {
  wallet: (name: string) => `warthogWallet_${name}`,
  walletNames: 'warthogWalletNames',
  nonce: (address: string) => `warthogNextNonce_${address}`,
} as const;

export const WORD_COUNTS = [12, 24] as const;

export const API_ENDPOINTS = {
  chainHead: (node: string) => `${node}/chain/head`,
  accountBalance: (node: string, address: string) => `${node}/account/${address}/balance`,
  accountHistory: (node: string, address: string) => `${node}/account/${address}/history/4294967295`,
  transactionLookup: (node: string, txid: string) => `${node}/transaction/lookup/${txid}`,
  chainBlock: (node: string, height: number) => `${node}/chain/block/${height}`,
  transactionAdd: (node: string) => `${node}/transaction/add`,
  encode16bit: (node: string, value: string) => `${node}/tools/encode16bit/from_string/${value}`,
  coingeckoPrice: 'https://api.coingecko.com/api/v3/simple/price?ids=warthog&vs_currencies=usd',
} as const;

export const ADDRESS_LENGTH = 48;
export const PRIVATE_KEY_LENGTH = 64;

export const DEFAULT_FEE = '0.01';
export const SATOSHI_MULTIPLIER = 100000000; // 1 WART = 100,000,000 satoshis

export const TRANSACTION_HISTORY_PAGE_SIZE = 7;

export const REFRESH_TIMEOUT = 800; // ms
