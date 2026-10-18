/** Bitcoin, Hemi, and Solana. Same phrase as this wallet. */

/** Native segwit, same path as the Hemi app. */
export const BTC_PATH = "m/84'/0'/0'/0/0";

/** Backpack and Phantom account 0. All steps are hardened. */
export const SOL_PATH = "m/44'/501'/0'/0'";

export const HEMI_CHAIN_ID = 43111;
export const HEMI_RPC = 'https://rpc.hemi.network/rpc';
export const HEMI_EXPLORER = 'https://explorer.hemi.xyz';

/** hemiBTC and the mainnet vault the Hemi app uses. Vault index 8. */
export const HEMIBTC = '0xAA40c0c7644e0b2B224509571e10ad20d9C4ef28';
export const VAULT_FACTORY = '0xEAcA824F46c000fB89403846Bb57e6b913321081';
export const VAULT_INDEX = 8;

export const MEMPOOL = 'https://mempool.space';
/** First host that answers is used. publicnode failed TLS on the solana-rpc hostname. */
export const SOLANA_RPCS = [
  'https://solana.publicnode.com',
  'https://api.mainnet-beta.solana.com',
] as const;
export const SOLANA_EXPLORER = 'https://solscan.io';

/** Jupiter lite swap. Wrapped SOL is the mint Jupiter uses for native SOL. */
export const JUPITER_SWAP = 'https://lite-api.jup.ag/swap/v1';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const SPL_DECIMALS = 6;

/** A native segwit output below this is not relayed. */
export const DUST_SATS = 546n;

/** One signature on a legacy Solana transfer. */
export const SOL_FEE_LAMPORTS = 5_000n;

export const BTC_DECIMALS = 8;
export const SOL_DECIMALS = 9;
export const HEMI_DECIMALS = 18;
