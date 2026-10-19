/** Balances for the tokens listed on Ethereum, Hemi, and Solana. */

import { rawToDecimal } from './ethHoldings';
import { ETH_CHAIN_ID, ETH_RPC } from './ethTokens';
import { HEMI_CHAIN_ID, HEMI_RPC } from './networks/chains';
import { networkFetch } from './networks/http';
import { fetchSolBalance } from './networks/solana';
import { fetchSplBalance } from './networks/solswap';
import type { TokenNetwork, WalletToken } from './walletTokens';

const SELECTOR = '70a08231';

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

function endpoint(network: 'ethereum' | 'hemi'): { url: string; chainId: number } {
  return network === 'ethereum'
    ? { url: ETH_RPC, chainId: ETH_CHAIN_ID }
    : { url: HEMI_RPC, chainId: HEMI_CHAIN_ID };
}

async function assertChain(network: 'ethereum' | 'hemi'): Promise<string> {
  const { url, chainId } = endpoint(network);
  const live = await rpc(url, 'eth_chainId', []);
  if (BigInt(live) !== BigInt(chainId)) throw new Error('That network did not answer as mainnet.');
  return url;
}

async function readEvm(
  url: string,
  owner: string,
  token: { native: boolean; address: string },
  blockTag: string,
): Promise<bigint> {
  if (token.native) return BigInt(await rpc(url, 'eth_getBalance', [owner, blockTag]));
  const data = `0x${SELECTOR}${owner.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  return BigInt(await rpc(url, 'eth_call', [{ to: token.address, data }, blockTag]));
}

/** One token balance as an integer. */
export async function readOneBalance(
  network: TokenNetwork,
  owner: string,
  token: { native: boolean; address: string; program?: string },
  blockTag = 'latest',
): Promise<bigint> {
  if (network === 'solana') {
    if (token.native) return fetchSolBalance(owner);
    return fetchSplBalance(owner, token.address, token.program);
  }
  const url = await assertChain(network);
  return readEvm(url, owner, token, blockTag);
}

/** Decimal strings keyed by token id. One failed call leaves that row empty. */
export async function readHoldingAmounts(
  owner: string,
  tokens: WalletToken[],
  blockTag = 'latest',
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const network = tokens[0]?.network;
  let evmUrl: string | null = null;
  if (network === 'ethereum' || network === 'hemi') {
    try {
      evmUrl = await assertChain(network);
    } catch {
      tokens.forEach((token) => { out[token.id] = null; });
      return out;
    }
  }
  await Promise.all(tokens.map(async (token) => {
    try {
      const raw = token.network === 'solana'
        ? await readOneBalance(token.network, owner, token)
        : await readEvm(evmUrl as string, owner, token, blockTag);
      out[token.id] = rawToDecimal(raw, token.decimals);
    } catch {
      out[token.id] = null;
    }
  }));
  return out;
}
