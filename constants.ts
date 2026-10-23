// constants.ts - App-wide constants

export const DEFI_TESTNET_URL = 'https://warthog-defitestnet.duckdns.org';

/** Wartnode mainnet. Same chain as the official mainnet, node v0.8.20. */
export const WARTNODE_MAINNET_URL = 'https://mainnet.wartnode.com';

/** Wartnode testnet. Same chain as the DeFi testnet. */
export const WARTNODE_TESTNET_URL = 'https://testnet.wartnode.com';

export const WARTHOG_NODES = [
  'https://warthognode.duckdns.org',
  WARTNODE_MAINNET_URL,
  DEFI_TESTNET_URL,
  WARTNODE_TESTNET_URL,
] as const;

export type NodeUrl = typeof WARTHOG_NODES[number];

export const DERIVATION_PATHS = {
  hardened: "m/44'/2070'/0'/0/0",
  normal: "m/44'/2070'/0/0/0",
} as const;

/** Same BIP39 phrase, Ethereum account. Matches the Hemi wallet path. */
export const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

export const SECURE_STORE_KEYS = {
  wallet: (name: string) => `warthogWallet_${name}`,
  walletNames: 'warthogWalletNames',
  nonce: (address: string) => `warthogNextNonce_${address}`,
  numberDisplayPrefs: 'wartbunkerNumberDisplayPrefs',
  /** On-device SafeTrade key. Older builds stored Tidoex in the same blob. */
  exchangeKeys: 'warthogExchangeKeys',
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
