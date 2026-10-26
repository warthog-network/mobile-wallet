import { ethers } from 'ethers';
import { sendEthCall } from '../ethChain';
import { chainPublic, getLedgerSession, getSessionAccountIndex } from '../sessionVault';
import { formatRawAmount } from '../ethHoldings';
import { networkFetch } from './http';
import { sendRawSolana, signSolanaTransaction } from './solana';
import { formatUnits, parseUnits } from './units';

/** deBridge DLN. Jupiter's own bridge page sends ETH on Ethereum to native SOL through this. */
const DLN = 'https://dln.debridge.finance/v1.0/dln/order';
const ETH_CHAIN = '1';
const SOL_CHAIN = '7565164';
const ETH_NATIVE = '0x0000000000000000000000000000000000000000';
const SOL_NATIVE = '11111111111111111111111111111111';
/**
 * DeBridgeRouter on Ethereum. The DLN API uses this contract to place the order.
 * https://docs.debridge.com/dln-details/overview/deployed-contracts
 */
const DEBRIDGE_ROUTER = '0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251';

export type DebridgeDirection = 'eth-to-sol' | 'sol-to-eth';

export type DebridgeQuote = {
  direction: DebridgeDirection;
  amountIn: bigint;
  fixFee: bigint;
  charged: bigint;
  expectedOut: bigint;
  slippagePct: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function clean(message: string): string {
  if (/not allowed account type/i.test(message)) {
    return 'deBridge cannot use this Solana account. It has to be a normal wallet address.';
  }
  return message.replace(/^error:\s*/i, '').slice(0, 220) || 'deBridge rejected the quote.';
}

function endpoint(kind: 'quote' | 'create-tx', direction: DebridgeDirection, amountIn: bigint, ethAddress: string, solAddress: string): string {
  const ethToSol = direction === 'eth-to-sol';
  const params = new URLSearchParams({
    srcChainId: ethToSol ? ETH_CHAIN : SOL_CHAIN,
    srcChainTokenIn: ethToSol ? ETH_NATIVE : SOL_NATIVE,
    srcChainTokenInAmount: amountIn.toString(),
    dstChainId: ethToSol ? SOL_CHAIN : ETH_CHAIN,
    dstChainTokenOut: ethToSol ? SOL_NATIVE : ETH_NATIVE,
    dstChainTokenOutAmount: 'auto',
    dstChainTokenOutRecipient: ethToSol ? solAddress : ethAddress,
    srcChainOrderAuthorityAddress: ethToSol ? ethAddress : solAddress,
    dstChainOrderAuthorityAddress: ethToSol ? solAddress : ethAddress,
    prependOperatingExpenses: 'false',
  });
  return `${DLN}/${kind}?${params.toString()}`;
}

async function dln(url: string): Promise<Record<string, unknown>> {
  const res = await networkFetch(url);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!isRecord(body)) throw new Error('deBridge returned an incomplete quote.');
  if (!res.ok) {
    const message = typeof body.errorMessage === 'string' ? body.errorMessage : 'deBridge rejected the quote.';
    throw new Error(clean(message));
  }
  return body;
}

function amountOf(value: unknown, field: string): bigint {
  if (!isRecord(value) || value.amount == null) throw new Error('deBridge returned an incomplete quote.');
  try {
    return BigInt(String(value[field] ?? value.amount));
  } catch {
    throw new Error('deBridge returned an incomplete quote.');
  }
}

function readQuote(body: Record<string, unknown>, direction: DebridgeDirection, amountIn: bigint): DebridgeQuote {
  const estimation = isRecord(body.estimation) ? body.estimation : null;
  if (!estimation) throw new Error('deBridge returned an incomplete quote.');
  const src = amountOf(estimation.srcChainTokenIn, 'amount');
  if (src !== amountIn) throw new Error('deBridge changed the amount.');
  const dst = isRecord(estimation.dstChainTokenOut) ? estimation.dstChainTokenOut : null;
  if (!dst) throw new Error('deBridge returned an incomplete quote.');
  const expectedOut = amountOf(dst, 'recommendedAmount');
  if (expectedOut <= 0n) throw new Error('deBridge returned an empty quote.');
  let fixFee = 0n;
  if (body.fixFee != null) {
    try {
      fixFee = BigInt(String(body.fixFee));
    } catch {
      throw new Error('deBridge returned an incomplete quote.');
    }
  }
  if (fixFee < 0n) throw new Error('deBridge returned an incomplete quote.');
  const slip = Number(estimation.recommendedSlippage);
  const slippagePct = Number.isFinite(slip) && slip >= 0 ? `${slip}%` : '—';
  return {
    direction,
    amountIn,
    fixFee,
    charged: amountIn + fixFee,
    expectedOut,
    slippagePct,
  };
}

export function parseDebridgeAmount(direction: DebridgeDirection, amount: string): bigint {
  return parseUnits(amount, direction === 'eth-to-sol' ? 18 : 9, direction === 'eth-to-sol' ? 'ETH' : 'SOL');
}

export function formatDebridgeAmount(direction: DebridgeDirection, raw: bigint, side: 'in' | 'out'): string {
  const decimals = direction === 'eth-to-sol'
    ? (side === 'in' ? 18 : 9)
    : (side === 'in' ? 9 : 18);
  if (decimals === 18) return formatRawAmount(raw, 18, 6);
  return formatUnits(raw, 9);
}

/** Price from the public quote. The signable transaction comes from create-tx at confirm time. */
export async function quoteDebridge(input: {
  direction: DebridgeDirection;
  amountIn: bigint;
  ethAddress: string;
  solAddress: string;
}): Promise<DebridgeQuote> {
  const body = await dln(endpoint('quote', input.direction, input.amountIn, input.ethAddress, input.solAddress));
  return readQuote(body, input.direction, input.amountIn);
}

function hexBytes(data: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length < 12 || data.length % 2 !== 0) {
    throw new Error('deBridge did not return a transaction.');
  }
  return ethers.getBytes(data);
}

/**
 * Re-quote and sign only when the contract, the fee, and the amount out still match.
 * Ethereum goes to the published DeBridgeRouter. Solana must be one signature by this wallet.
 */
export async function executeDebridge(
  quote: DebridgeQuote,
  ethAddress: string,
  solAddress: string,
): Promise<string> {
  const body = await dln(endpoint('create-tx', quote.direction, quote.amountIn, ethAddress, solAddress));
  const fresh = readQuote(body, quote.direction, quote.amountIn);
  if (fresh.expectedOut < quote.expectedOut) {
    throw new Error('deBridge lowered the amount you receive. Review it again.');
  }
  if (fresh.charged > quote.charged) {
    throw new Error('deBridge raised the fee. Review it again.');
  }
  const tx = isRecord(body.tx) ? body.tx : null;
  if (!tx || typeof tx.data !== 'string') throw new Error('deBridge did not return a transaction.');

  if (quote.direction === 'eth-to-sol') {
    if (typeof tx.to !== 'string' || typeof tx.value !== 'string') {
      throw new Error('deBridge did not return an Ethereum transaction.');
    }
    const to = ethers.getAddress(tx.to);
    if (to !== ethers.getAddress(DEBRIDGE_ROUTER)) {
      throw new Error('deBridge returned an unexpected contract.');
    }
    const value = BigInt(tx.value);
    if (value !== fresh.charged) throw new Error('deBridge changed the ETH amount.');
    const ledger = getLedgerSession();
    if (ledger) {
      if (!ledger.ethAddress || ledger.ethAddress.toLowerCase() !== ethAddress.toLowerCase()) {
        throw new Error('This Ethereum account is not unlocked.');
      }
    } else {
      const pubs = chainPublic(getSessionAccountIndex());
      if (!pubs) throw new Error('This bridge needs the recovery phrase.');
      if (pubs.ethAddress.toLowerCase() !== ethAddress.toLowerCase()) {
        throw new Error('This Ethereum account is not unlocked.');
      }
    }
    const receipt = await sendEthCall({ to, data: tx.data, value });
    return receipt.hash;
  }

  const raw = hexBytes(tx.data);
  const signed = await signSolanaTransaction(raw, solAddress);
  return await sendRawSolana(signed);
}
