import AsyncStorage from '@react-native-async-storage/async-storage';
import { base64 } from '@scure/base';
import { ethers } from 'ethers';
import { deriveEthWallet } from '../evmAddress';
import { sendEthCall } from '../ethChain';
import { ETH_CHAIN_ID, ETH_RPC, ETH_USDT, ETH_USDC } from '../ethTokens';
import { getLedgerSession, getSessionMnemonic } from '../sessionVault';
import { USDC_MINT, USDT_MINT } from './chains';
import { deriveChainKeys } from './derive';
import { networkFetch } from './http';
import { sendRawSolana, signSolanaTransaction } from './solana';
import { formatUnits, parseUnits } from './units';

/**
 * Quotes behind https://edge.jup.ag/bridge. The page posts here with no key
 * for Relay and Mayan. One side is always Solana.
 */
const API = 'https://bridge-api.gum.ag/api/bridge';
const STORE_KEY = 'warthogJupBridges';

/** Relay Depository on Ethereum. https://docs.relay.link/references/protocol/depository/addresses */
const RELAY_DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
/** Mayan Forwarder, same address on every EVM chain. https://docs.mayan.finance/integration/forwarder-contract */
const MAYAN_FORWARDER = '0x337685fdaB40D39bd02028545a4FfA7D287cC3E2';

const APPROVE = new ethers.Interface([
  'function approve(address,uint256)',
  'function allowance(address,address) view returns (uint256)',
]);

export type JupBridgeChain = 'ethereum' | 'solana';
export type JupBridgeDirection = 'eth-to-sol' | 'sol-to-eth';
export type JupBridgeProvider = 'relay' | 'mayan';

/** An asset the bridge API quoted on 2026-10-18. Native ETH uses the zero address. */
export type JupBridgeAsset = {
  chain: JupBridgeChain;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  native: boolean;
};

export const BRIDGE_ETH: JupBridgeAsset = {
  chain: 'ethereum',
  symbol: 'ETH',
  name: 'Ether',
  address: '0x0000000000000000000000000000000000000000',
  decimals: 18,
  native: true,
};
export const BRIDGE_SOL: JupBridgeAsset = {
  chain: 'solana',
  symbol: 'SOL',
  name: 'Solana',
  address: '11111111111111111111111111111111',
  decimals: 9,
  native: true,
};
export const BRIDGE_ETH_USDC: JupBridgeAsset = {
  chain: 'ethereum', symbol: 'USDC', name: 'USD Coin', address: ETH_USDC, decimals: 6, native: false,
};
export const BRIDGE_ETH_USDT: JupBridgeAsset = {
  chain: 'ethereum', symbol: 'USDT', name: 'Tether', address: ETH_USDT, decimals: 6, native: false,
};
export const BRIDGE_SOL_USDC: JupBridgeAsset = {
  chain: 'solana', symbol: 'USDC', name: 'USD Coin', address: USDC_MINT, decimals: 6, native: false,
};
export const BRIDGE_SOL_USDT: JupBridgeAsset = {
  chain: 'solana', symbol: 'USDT', name: 'Tether', address: USDT_MINT, decimals: 6, native: false,
};

const BRIDGE_ASSETS = [BRIDGE_ETH, BRIDGE_ETH_USDC, BRIDGE_ETH_USDT, BRIDGE_SOL, BRIDGE_SOL_USDC, BRIDGE_SOL_USDT];

export function bridgeAssets(chain: JupBridgeChain): JupBridgeAsset[] {
  return BRIDGE_ASSETS.filter((asset) => asset.chain === chain);
}

export type JupBridgeRoute = {
  direction: JupBridgeDirection;
  pay: JupBridgeAsset;
  receive: JupBridgeAsset;
  provider: JupBridgeProvider;
  label: string;
  amountIn: bigint;
  expectedOut: bigint;
  minOut: bigint;
  expiresAt: number;
  slippageBps: number;
  feeUsd: string | null;
  etaSeconds: number | null;
  appFeeBps: number | null;
  payload: unknown;
};

export type JupBridgeMove = {
  id: string;
  createdAt: number;
  paySymbol: string;
  receiveSymbol: string;
  amountIn: string;
  expectedOut: string;
  payDecimals: number;
  receiveDecimals: number;
  fromChain: JupBridgeChain;
  toChain: JupBridgeChain;
  provider: string;
  label: string;
  txHash: string;
  ethAddress: string;
  solAddress: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function digits(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function sameAccount(left: string, right: string, evm: boolean): boolean {
  return evm ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sameAsset(left: JupBridgeAsset, right: JupBridgeAsset): boolean {
  return left.chain === right.chain && left.address.toLowerCase() === right.address.toLowerCase();
}

function clean(err: unknown): Error {
  const message = err instanceof Error ? err.message : 'Could not quote that bridge.';
  if (/not allowed account type/i.test(message)) {
    return new Error('This route cannot use this Solana account. It has to be a normal wallet address.');
  }
  return err instanceof Error ? err : new Error(message);
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await networkFetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  if (res.status === 410) throw new Error('This quote expired. Review it again.');
  if (res.status === 429) throw new Error('Bridge quotes are busy. Wait a moment and try again.');
  if (!res.ok) {
    const minimum = isRecord(data) ? data.minimumUsd : null;
    if (typeof minimum === 'number' || typeof minimum === 'string') {
      throw new Error(`Minimum bridge amount is $${minimum}.`);
    }
    throw new Error('No route is available for that amount.');
  }
  return data;
}

function apiToken(asset: JupBridgeAsset): Record<string, unknown> {
  return {
    chainId: asset.chain === 'ethereum' ? 'evm:1' : 'solana:mainnet',
    address: asset.address,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    isNative: asset.native,
  };
}

function requestBody(
  pay: JupBridgeAsset,
  receive: JupBridgeAsset,
  amountIn: bigint,
  ethAddress: string,
  solAddress: string,
  slippageBps: number,
): Record<string, unknown> {
  const ethToSol = pay.chain === 'ethereum';
  return {
    inputToken: apiToken(pay),
    outputToken: apiToken(receive),
    amount: amountIn.toString(),
    slippageBps,
    execution: {
      sourceAddress: ethToSol ? ethAddress : solAddress,
      recipient: ethToSol ? solAddress : ethAddress,
    },
  };
}

function readRoute(
  value: unknown,
  pay: JupBridgeAsset,
  receive: JupBridgeAsset,
  amountIn: bigint,
  ethAddress: string,
  solAddress: string,
  slippageBps: number,
): JupBridgeRoute | null {
  if (!isRecord(value)) return null;
  if (value.provider !== 'relay' && value.provider !== 'mayan') return null;
  const expectedOut = digits(value.outAmount);
  const minOut = digits(value.minOutAmount);
  if (expectedOut == null || minOut == null || expectedOut <= 0n || minOut <= 0n || minOut > expectedOut) return null;
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return null;
  const execution = isRecord(value.execution) ? value.execution : null;
  if (!execution || typeof execution.sourceAddress !== 'string' || typeof execution.recipient !== 'string') return null;
  const ethToSol = pay.chain === 'ethereum';
  const source = ethToSol ? ethAddress : solAddress;
  const recipient = ethToSol ? solAddress : ethAddress;
  if (!sameAccount(execution.sourceAddress, source, ethToSol)) return null;
  if (!sameAccount(execution.recipient, recipient, !ethToSol)) return null;
  if (execution.payload == null) return null;
  const label = typeof value.routeLabel === 'string' && value.routeLabel.trim()
    ? value.routeLabel.trim()
    : value.provider === 'relay' ? 'Relay' : 'Mayan';
  return {
    direction: ethToSol ? 'eth-to-sol' : 'sol-to-eth',
    pay,
    receive,
    provider: value.provider,
    label,
    amountIn,
    expectedOut,
    minOut,
    expiresAt: value.expiresAt,
    slippageBps,
    feeUsd: typeof value.feeUsd === 'string' ? value.feeUsd : null,
    etaSeconds: typeof value.etaSeconds === 'number' ? value.etaSeconds : null,
    appFeeBps: typeof value.appFeeBps === 'number' ? value.appFeeBps : null,
    payload: execution.payload,
  };
}

/** Live Relay and Mayan quotes. One asset is on Ethereum and the other is on Solana. */
export async function quoteJupBridge(input: {
  pay: JupBridgeAsset;
  receive: JupBridgeAsset;
  amountIn: bigint;
  ethAddress: string;
  solAddress: string;
  slippageBps: number;
}): Promise<JupBridgeRoute[]> {
  if (input.pay.chain === input.receive.chain) throw new Error('Pick one asset on Ethereum and one on Solana.');
  const known = BRIDGE_ASSETS.some((asset) => sameAsset(asset, input.pay))
    && BRIDGE_ASSETS.some((asset) => sameAsset(asset, input.receive));
  if (!known) throw new Error('That asset is not on this bridge.');
  try {
    const body = requestBody(input.pay, input.receive, input.amountIn, input.ethAddress, input.solAddress, input.slippageBps);
    const data = await postJson('quote', body);
    if (!isRecord(data) || !Array.isArray(data.routes)) {
      throw new Error('No route is available for that amount.');
    }
    const routes = data.routes
      .map((row) => readRoute(row, input.pay, input.receive, input.amountIn, input.ethAddress, input.solAddress, input.slippageBps))
      .filter((row): row is JupBridgeRoute => row != null)
      .sort((a, b) => (a.expectedOut > b.expectedOut ? -1 : a.expectedOut < b.expectedOut ? 1 : 0));
    if (routes.length === 0) throw new Error('No route is available for that amount.');
    return routes;
  } catch (err) {
    throw clean(err);
  }
}

function allowlistedTarget(provider: JupBridgeProvider): string {
  return ethers.getAddress(provider === 'relay' ? RELAY_DEPOSITORY : MAYAN_FORWARDER);
}

function readApprove(step: Record<string, unknown>, pay: JupBridgeAsset, spender: string, amountIn: bigint): string {
  if (step.kind !== 'evm-approve' || step.chainId !== 1) throw new Error('This route needs an unexpected approval.');
  if (typeof step.token !== 'string' || ethers.getAddress(step.token) !== ethers.getAddress(pay.address)) {
    throw new Error('The route asked to approve a different token.');
  }
  if (typeof step.spender !== 'string' || ethers.getAddress(step.spender) !== spender) {
    throw new Error('The route asked to approve a different contract.');
  }
  if (typeof step.amount !== 'string' || BigInt(step.amount) !== amountIn) {
    throw new Error('The route changed the token amount.');
  }
  if (typeof step.data !== 'string' || !step.data.startsWith('0x095ea7b3')) {
    throw new Error('The route did not return an approval.');
  }
  const decoded = APPROVE.decodeFunctionData('approve', step.data);
  if (ethers.getAddress(String(decoded[0])) !== spender || (decoded[1] as bigint) !== amountIn) {
    throw new Error('The route did not return an approval.');
  }
  return step.data;
}

async function erc20Allowance(token: string, owner: string, spender: string): Promise<bigint> {
  const network = ethers.Network.from(ETH_CHAIN_ID);
  const client = new ethers.JsonRpcProvider(ETH_RPC, network, { staticNetwork: network });
  try {
    const hex = await client.send('eth_chainId', []);
    if (BigInt(hex) !== BigInt(ETH_CHAIN_ID)) throw new Error('Ethereum RPC is not mainnet.');
    const data = APPROVE.encodeFunctionData('allowance', [owner, spender]);
    const result = await client.call({ to: token, data });
    return BigInt(result);
  } finally {
    client.destroy();
  }
}

async function saveMove(move: JupBridgeMove): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    const rows = raw ? JSON.parse(raw) as JupBridgeMove[] : [];
    const next = [move, ...(Array.isArray(rows) ? rows.filter((row) => row.id !== move.id) : [])].slice(0, 40);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // The transfer is already sent. A missed history row can be read from the explorer.
  }
}

export async function readJupBridgeMoves(ethAddress: string, solAddress: string): Promise<JupBridgeMove[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as JupBridgeMove[];
    if (!Array.isArray(rows)) return [];
    const eth = ethAddress.toLowerCase();
    const sol = solAddress;
    return rows.filter((row) => row.ethAddress?.toLowerCase() === eth || row.solAddress === sol);
  } catch {
    return [];
  }
}

/**
 * Quote again, then sign only when the received amount held.
 * Native ETH is one payment to Relay or Mayan. An ERC-20 is an approval of
 * that exact amount to the same contract, then a zero-ETH deposit.
 * Solana is one signature by this wallet.
 */
export async function executeJupBridge(
  route: JupBridgeRoute,
  ethAddress: string,
  solAddress: string,
): Promise<string> {
  const freshRoutes = await quoteJupBridge({
    pay: route.pay,
    receive: route.receive,
    amountIn: route.amountIn,
    ethAddress,
    solAddress,
    slippageBps: route.slippageBps,
  });
  const fresh = freshRoutes.find((row) => row.provider === route.provider);
  if (!fresh) throw new Error('That route is no longer available. Review it again.');
  if (fresh.minOut < route.minOut) throw new Error('The route lowered the amount you receive. Review it again.');

  const built = await postJson('build', {
    ...requestBody(route.pay, route.receive, route.amountIn, ethAddress, solAddress, route.slippageBps),
    provider: fresh.provider,
    quote: {
      expectedOut: fresh.expectedOut.toString(),
      minOut: fresh.minOut.toString(),
      expiresAt: fresh.expiresAt,
      payload: fresh.payload,
    },
  });
  if (!isRecord(built) || built.provider !== fresh.provider || !Array.isArray(built.steps)) {
    throw new Error('The route did not return a transaction.');
  }
  const target = allowlistedTarget(fresh.provider);

  let hash: string;
  if (route.pay.chain === 'ethereum') {
    hash = await sendEthereum(built.steps, route, ethAddress, target);
  } else {
    hash = await sendSolana(built.steps, solAddress);
  }
  await saveMove({
    id: hash,
    createdAt: Date.now(),
    paySymbol: route.pay.symbol,
    receiveSymbol: route.receive.symbol,
    amountIn: route.amountIn.toString(),
    expectedOut: fresh.expectedOut.toString(),
    payDecimals: route.pay.decimals,
    receiveDecimals: route.receive.decimals,
    fromChain: route.pay.chain,
    toChain: route.receive.chain,
    provider: fresh.provider,
    label: fresh.label,
    txHash: hash,
    ethAddress,
    solAddress,
  });
  return hash;
}

async function sendEthereum(
  steps: unknown[],
  route: JupBridgeRoute,
  ethAddress: string,
  target: string,
): Promise<string> {
  const approve = steps.length === 2 ? steps[0] : null;
  const step = steps[steps.length - 1];
  if (route.pay.native) {
    if (steps.length !== 1) throw new Error('This route needs more than one transaction.');
  } else if (steps.length !== 1 && steps.length !== 2) {
    throw new Error('This route needs more than one transaction.');
  }
  if (!isRecord(step)) throw new Error('The route did not return an Ethereum transaction.');
  if (step.kind !== 'evm' || step.chainId !== 1 || step.funding !== true) {
    throw new Error('The route did not return an Ethereum transaction.');
  }
  if (typeof step.to !== 'string' || typeof step.value !== 'string' || typeof step.data !== 'string') {
    throw new Error('The route did not return an Ethereum transaction.');
  }
  const to = ethers.getAddress(step.to);
  if (to !== target) throw new Error('The route returned an unexpected contract.');
  const value = BigInt(step.value);
  if (route.pay.native && value !== route.amountIn) throw new Error('The route changed the ETH amount.');
  if (!route.pay.native && value !== 0n) throw new Error('The route asked for ETH on a token bridge.');
  if (!/^0x[0-9a-fA-F]+$/.test(step.data) || step.data.length < 10) {
    throw new Error('The route did not return an Ethereum transaction.');
  }
  const ledger = getLedgerSession();
  if (ledger) {
    if (!ledger.ethAddress || ledger.ethAddress.toLowerCase() !== ethAddress.toLowerCase()) {
      throw new Error('This Ethereum account is not unlocked.');
    }
  } else {
    const mnemonic = getSessionMnemonic();
    if (!mnemonic) throw new Error('This bridge needs the recovery phrase.');
    if (deriveEthWallet(mnemonic).address.toLowerCase() !== ethAddress.toLowerCase()) {
      throw new Error('This Ethereum account is not unlocked.');
    }
  }
  if (!route.pay.native && approve != null) {
    if (!isRecord(approve)) throw new Error('The route did not return an approval.');
    const data = readApprove(approve, route.pay, target, route.amountIn);
    const allowance = await erc20Allowance(route.pay.address, ethAddress, target);
    if (allowance < route.amountIn) {
      const usdt = route.pay.address.toLowerCase() === ETH_USDT.toLowerCase();
      if (usdt && allowance > 0n) {
        const reset = APPROVE.encodeFunctionData('approve', [target, 0n]);
        await sendEthCall({ to: route.pay.address, data: reset });
      }
      await sendEthCall({ to: route.pay.address, data });
    }
  } else if (!route.pay.native) {
    const allowance = await erc20Allowance(route.pay.address, ethAddress, target);
    if (allowance < route.amountIn) throw new Error('This route did not include the token approval.');
  }
  const receipt = await sendEthCall({ to, data: step.data, value });
  return receipt.hash;
}

async function sendSolana(steps: unknown[], solAddress: string): Promise<string> {
  if (steps.length !== 1) throw new Error('This route needs more than one transaction.');
  const step = steps[0];
  if (!isRecord(step) || step.kind !== 'svm' || step.submit !== 'broadcast' || typeof step.transaction !== 'string') {
    throw new Error('The route did not return a Solana transaction.');
  }
  const raw = base64.decode(step.transaction);
  const signed = await signSolanaTransaction(raw, solAddress);
  return await sendRawSolana(signed);
}

export function parseBridgeAmount(amount: string, asset: JupBridgeAsset): bigint {
  return parseUnits(amount, asset.decimals, asset.symbol);
}

export function formatBridgeAmount(raw: bigint, decimals: number): string {
  const text = formatUnits(raw, decimals);
  const [whole, frac] = text.split('.');
  if (!frac) return whole;
  const trimmed = frac.slice(0, 8).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
