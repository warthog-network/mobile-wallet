import { sha256 } from '@noble/hashes/sha2';
import { base58, base64 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import {
  JUPITER_SWAP,
  SPL_DECIMALS,
  SOL_DECIMALS,
  USDC_MINT,
  USDT_MINT,
  WSOL_MINT,
} from './chains';
import { deriveChainKeys } from './derive';
import { networkFetch } from './http';
import { sendRawSolana, signVersionedTransaction, solanaRpc } from './solana';
import { formatUnits, parseUnits } from './units';
import { getSessionMnemonic } from '../sessionVault';

const TOKEN_PROGRAM = base58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = base58.decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PDA_MARK = new TextEncoder().encode('ProgramDerivedAddress');

export type StableSymbol = 'USDC' | 'USDT';
export type SwapSide = 'SOL' | StableSymbol;

export const STABLES: Record<StableSymbol, { mint: string; decimals: number }> = {
  USDC: { mint: USDC_MINT, decimals: SPL_DECIMALS },
  USDT: { mint: USDT_MINT, decimals: SPL_DECIMALS },
};

type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: { swapInfo?: { label?: string } }[];
};

export type SwapQuote = {
  raw: JupiterQuote;
  outAmount: bigint;
  outText: string;
  impactPct: string;
  route: string;
  minimumText: string;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function onCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Solana program address. Matches web3.js findProgramAddressSync. */
export function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): Uint8Array {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(concat([...seeds, Uint8Array.from([bump]), programId, PDA_MARK]));
    if (!onCurve(hash)) return hash;
  }
  throw new Error('Could not derive the token account.');
}

export function associatedTokenAddress(owner: string, mint: string): string {
  const pda = findProgramAddress(
    [base58.decode(owner), TOKEN_PROGRAM, base58.decode(mint)],
    ATA_PROGRAM,
  );
  return base58.encode(pda);
}

export async function fetchSplBalance(owner: string, mint: string): Promise<bigint> {
  const ata = associatedTokenAddress(owner, mint);
  try {
    const result = await solanaRpc<{ value: { amount: string } }>('getTokenAccountBalance', [ata]);
    return BigInt(result.value.amount);
  } catch {
    return 0n;
  }
}

function mintOf(side: SwapSide): string {
  return side === 'SOL' ? WSOL_MINT : STABLES[side].mint;
}

function decimalsOf(side: SwapSide): number {
  return side === 'SOL' ? SOL_DECIMALS : SPL_DECIMALS;
}

export function parseSwapAmount(amount: string, side: SwapSide): bigint {
  return parseUnits(amount, decimalsOf(side), side);
}

export function formatSwapAmount(raw: bigint, side: SwapSide): string {
  return formatUnits(raw, decimalsOf(side));
}

/** Leave this much SOL so the network fee and a new token account can land. */
export const SOL_SWAP_RESERVE = 10_000_000n;

export function maxSwapAmount(raw: bigint, side: SwapSide): bigint {
  if (side !== 'SOL') return raw > 0n ? raw : 0n;
  return raw > SOL_SWAP_RESERVE ? raw - SOL_SWAP_RESERVE : 0n;
}

export async function quoteSwap(
  pay: SwapSide,
  receive: SwapSide,
  amount: bigint,
  slippageBps: number,
): Promise<SwapQuote> {
  if (pay === receive) throw new Error('Choose two different assets.');
  const params = new URLSearchParams({
    inputMint: mintOf(pay),
    outputMint: mintOf(receive),
    amount: amount.toString(),
    slippageBps: String(slippageBps),
  });
  const res = await networkFetch(`${JUPITER_SWAP}/quote?${params}`);
  const raw = (await res.json()) as JupiterQuote & { error?: string; message?: string };
  if (!res.ok || raw.error || !raw.outAmount) {
    throw new Error(raw.error || raw.message || 'Jupiter could not quote that swap.');
  }
  const labels = (raw.routePlan ?? [])
    .map((leg) => leg.swapInfo?.label)
    .filter((label): label is string => Boolean(label));
  return {
    raw,
    outAmount: BigInt(raw.outAmount),
    outText: formatSwapAmount(BigInt(raw.outAmount), receive),
    impactPct: raw.priceImpactPct || '0',
    route: labels.length ? labels.join(' → ') : 'Jupiter',
    minimumText: formatSwapAmount(BigInt(raw.otherAmountThreshold || raw.outAmount), receive),
  };
}

export async function executeSwap(owner: string, quote: JupiterQuote): Promise<{ signature: string }> {
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) throw new Error('A Solana swap needs the recovery phrase.');
  const keys = deriveChainKeys(mnemonic);
  try {
    if (keys.solAddress !== owner) throw new Error('This Solana account is not unlocked.');
    const res = await networkFetch(`${JUPITER_SWAP}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: owner,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });
    const body = (await res.json()) as { swapTransaction?: string; error?: string; message?: string };
    if (!res.ok || !body.swapTransaction) {
      throw new Error(body.error || body.message || 'Jupiter could not build the swap.');
    }
    const raw = base64.decode(body.swapTransaction);
    const signed = signVersionedTransaction(raw, keys.solPrivateKey);
    const signature = await sendRawSolana(signed);
    return { signature };
  } finally {
    keys.btcPrivateKey.fill(0);
    keys.solPrivateKey.fill(0);
  }
}


