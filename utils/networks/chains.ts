/** Bitcoin, Hemi, and Solana. Same phrase as this wallet. No tunnels or tokens. */

/** Native segwit, same path as the Hemi app. */
export const BTC_PATH = "m/84'/0'/0'/0/0";

/** Backpack and Phantom account 0. All steps are hardened. */
export const SOL_PATH = "m/44'/501'/0'/0'";

export const HEMI_CHAIN_ID = 43111;
export const HEMI_RPC = 'https://rpc.hemi.network/rpc';
export const HEMI_EXPLORER = 'https://explorer.hemi.xyz';

export const MEMPOOL = 'https://mempool.space';
/** First host that answers is used. publicnode failed TLS on the solana-rpc hostname. */
export const SOLANA_RPCS = [
  'https://solana.publicnode.com',
  'https://api.mainnet-beta.solana.com',
] as const;
export const SOLANA_EXPLORER = 'https://solscan.io';

/** A native segwit output below this is not relayed. */
export const DUST_SATS = 546n;

/** One signature on a legacy Solana transfer. */
export const SOL_FEE_LAMPORTS = 5_000n;

export const BTC_DECIMALS = 8;
export const SOL_DECIMALS = 9;
export const HEMI_DECIMALS = 18;
