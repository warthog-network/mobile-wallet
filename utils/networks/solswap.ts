import { sha256 } from '@noble/hashes/sha2';
import { base58, base64 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import {
  JUPITER_SWAP,
  SOL_FEE_LAMPORTS,
  SPL_DECIMALS,
  SOL_DECIMALS,
  USDC_MINT,
  USDT_MINT,
  WSOL_MINT,
} from './chains';
import { networkFetch } from './http';
import {
  assertSolAddress,
  currentSolanaOwner,
  fetchSolBalance,
  sendRawSolana,
  signSolanaTransaction,
  solanaRpc,
} from './solana';
import { formatUnits, parseUnits } from './units';

const TOKEN_PROGRAM = base58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = base58.decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new Uint8Array(32);
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

export function associatedTokenAddress(owner: string, mint: string, programId?: string): string {
  const program = programId ? base58.decode(programId) : TOKEN_PROGRAM;
  const pda = findProgramAddress(
    [base58.decode(owner), program, base58.decode(mint)],
    ATA_PROGRAM,
  );
  return base58.encode(pda);
}

type TokenAccountRow = {
  pubkey: string;
  account?: {
    data?: {
      parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } };
    } | string | [string, string];
  };
};

/** Every token account this owner has for the mint, including accounts that are not the main one. */
export async function listSplAccounts(
  owner: string,
  mint: string,
  programId?: string,
): Promise<{ address: string; amount: bigint }[]> {
  const result = await solanaRpc<{ value: TokenAccountRow[] }>('getTokenAccountsByOwner', [
    owner,
    programId ? { programId } : { mint },
    { encoding: 'jsonParsed' },
  ]);
  const rows = result.value ?? [];
  if (rows.some((row) => {
    const data = row.account?.data;
    return typeof data === 'string' || Array.isArray(data);
  })) {
    throw new Error('Solana did not return token balances.');
  }
  return rows.flatMap((row) => {
    const info = typeof row.account?.data === 'object' && !Array.isArray(row.account?.data)
      ? row.account?.data?.parsed?.info
      : undefined;
    if (!info?.tokenAmount?.amount) return [];
    if (programId && info.mint !== mint) return [];
    const amount = BigInt(info.tokenAmount.amount);
    if (amount <= 0n) return [];
    return [{ address: row.pubkey, amount }];
  });
}

async function ataAmount(owner: string, mint: string, programId?: string): Promise<bigint> {
  const ata = associatedTokenAddress(owner, mint, programId);
  try {
    const result = await solanaRpc<{ value: { amount: string } }>('getTokenAccountBalance', [ata]);
    return BigInt(result.value.amount);
  } catch {
    return 0n;
  }
}

/** Full mint balance. A wallet can hold the same coin in more than the main token account. */
export async function fetchSplBalance(owner: string, mint: string, programId?: string): Promise<bigint> {
  try {
    const rows = await listSplAccounts(owner, mint, programId);
    return rows.reduce((sum, row) => sum + row.amount, 0n);
  } catch {
    return ataAmount(owner, mint, programId);
  }
}

function compactU16(value: number): Uint8Array {
  const out: number[] = [];
  let left = value;
  while (true) {
    const elem = left & 0x7f;
    left >>= 7;
    if (left === 0) {
      out.push(elem);
      break;
    }
    out.push(elem | 0x80);
  }
  return Uint8Array.from(out);
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let left = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(left & 0xffn);
    left >>= 8n;
  }
  return out;
}

type AccountMeta = {
  address: string;
  key: Uint8Array;
  signer: boolean;
  writable: boolean;
};

/** Same options @solana/web3.js uses when it sorts accounts inside a privilege group. */
const ACCOUNT_SORT: Intl.CollatorOptions = {
  localeMatcher: 'best fit',
  usage: 'sort',
  sensitivity: 'variant',
  ignorePunctuation: false,
  numeric: false,
  caseFirst: 'lower',
};

function accountMeta(key: Uint8Array, signer: boolean, writable: boolean): AccountMeta {
  return { address: base58.encode(key), key, signer, writable };
}

/** Fee payer first, then web3.js order: signers, writable accounts, then address. */
function compileAccountKeys(metas: AccountMeta[], feePayer: Uint8Array): { keys: Uint8Array[]; header: number[] } {
  const unique: AccountMeta[] = [];
  metas.forEach((meta) => {
    const found = unique.find((row) => row.address === meta.address);
    if (found) {
      found.writable = found.writable || meta.writable;
      found.signer = found.signer || meta.signer;
      return;
    }
    unique.push({ ...meta });
  });
  unique.sort((x, y) => {
    if (x.signer !== y.signer) return x.signer ? -1 : 1;
    if (x.writable !== y.writable) return x.writable ? -1 : 1;
    return x.address.localeCompare(y.address, 'en', ACCOUNT_SORT);
  });
  const payerAddress = base58.encode(feePayer);
  const payerAt = unique.findIndex((row) => row.address === payerAddress);
  const payer = payerAt >= 0 ? unique.splice(payerAt, 1)[0] : accountMeta(feePayer, true, true);
  payer.signer = true;
  payer.writable = true;
  unique.unshift(payer);
  let numRequiredSignatures = 0;
  let numReadonlySignedAccounts = 0;
  let numReadonlyUnsignedAccounts = 0;
  unique.forEach((row) => {
    if (row.signer) {
      numRequiredSignatures += 1;
      if (!row.writable) numReadonlySignedAccounts += 1;
    } else if (!row.writable) {
      numReadonlyUnsignedAccounts += 1;
    }
  });
  return {
    keys: unique.map((row) => row.key),
    header: [numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts],
  };
}

function accountIndex(keys: Uint8Array[], key: Uint8Array): number {
  const address = base58.encode(key);
  const index = keys.findIndex((row) => base58.encode(row) === address);
  if (index < 0) throw new Error('Missing Solana account.');
  return index;
}

/**
 * Create the recipient token account if needed, then TransferChecked.
 * Account order matches @solana/web3.js for these two instructions.
 */
export function splPaymentMessage(input: {
  payer: Uint8Array;
  source: Uint8Array;
  destOwner: Uint8Array;
  destAta: Uint8Array;
  mint: Uint8Array;
  amount: bigint;
  decimals: number;
  blockhash: Uint8Array;
  /** Mint owner. Classic SPL when omitted. */
  tokenProgram?: Uint8Array;
}): Uint8Array {
  if (input.decimals < 0 || input.decimals > 9) throw new Error('Bad token decimals.');
  const payer = accountMeta(input.payer, true, true);
  const source = accountMeta(input.source, false, true);
  const destOwner = accountMeta(input.destOwner, false, false);
  const destAta = accountMeta(input.destAta, false, true);
  const mint = accountMeta(input.mint, false, false);
  const system = accountMeta(SYSTEM_PROGRAM, false, false);
  const tokenProgram = accountMeta(input.tokenProgram ?? TOKEN_PROGRAM, false, false);
  const ataProgram = accountMeta(ATA_PROGRAM, false, false);
  const compiled = compileAccountKeys([
    payer, destAta, destOwner, mint, system, tokenProgram, ataProgram,
    source, mint, destAta, payer, tokenProgram,
  ], input.payer);
  const at = (meta: AccountMeta) => accountIndex(compiled.keys, meta.key);
  const createAccounts = [payer, destAta, destOwner, mint, system, tokenProgram].map(at);
  const transferAccounts = [source, mint, destAta, payer].map(at);
  const createData = Uint8Array.from([1]);
  const transferData = concat([Uint8Array.from([12]), u64le(input.amount), Uint8Array.from([input.decimals])]);
  return concat([
    Uint8Array.from(compiled.header),
    compactU16(compiled.keys.length),
    ...compiled.keys,
    input.blockhash,
    compactU16(2),
    Uint8Array.from([at(ataProgram)]),
    compactU16(createAccounts.length),
    Uint8Array.from(createAccounts),
    compactU16(createData.length),
    createData,
    Uint8Array.from([at(tokenProgram)]),
    compactU16(transferAccounts.length),
    Uint8Array.from(transferAccounts),
    compactU16(transferData.length),
    transferData,
  ]);
}

/** Send an SPL token from this Solana account to another Solana wallet address. */
export async function sendSpl(input: {
  mint: string;
  decimals: number;
  toOwner: string;
  amount: string;
  symbol: string;
  /** Token program that owns the mint. Classic SPL when omitted. */
  program?: string;
}): Promise<{ signature: string }> {
  const owner = currentSolanaOwner();
  const destination = base58.encode(assertSolAddress(input.toOwner));
  if (destination === owner.address) throw new Error('That address is this wallet.');
  const rawAmount = parseUnits(input.amount, input.decimals, input.symbol);
  const programId = input.program;
  const ownAta = associatedTokenAddress(owner.address, input.mint, programId);
  let holdings: { address: string; amount: bigint }[];
  try {
    holdings = await listSplAccounts(owner.address, input.mint, programId);
  } catch {
    const amount = await ataAmount(owner.address, input.mint, programId);
    holdings = amount > 0n ? [{ address: ownAta, amount }] : [];
  }
  const source = holdings.find((row) => row.address === ownAta && row.amount >= rawAmount)
    ?? holdings.find((row) => row.amount >= rawAmount);
  const total = holdings.reduce((sum, row) => sum + row.amount, 0n);
  if (!source) {
    const largest = holdings.reduce((best, row) => (row.amount > best ? row.amount : best), 0n);
    if (total >= rawAmount && largest < rawAmount) {
      throw new Error(`${input.symbol} is split across token accounts. The largest one has ${formatUnits(largest, input.decimals)}.`);
    }
    throw new Error(`Only ${formatUnits(total, input.decimals)} ${input.symbol} is in this wallet.`);
  }
  const destAta = associatedTokenAddress(destination, input.mint, programId);
  const rentBytes = programId && programId !== base58.encode(TOKEN_PROGRAM) ? 182 : 165;
  const [sol, destInfo, rent, latest] = await Promise.all([
    fetchSolBalance(owner.address),
    solanaRpc<{ value: unknown | null }>('getAccountInfo', [destAta, { encoding: 'base64' }]),
    solanaRpc<number>('getMinimumBalanceForRentExemption', [rentBytes]).then(BigInt).catch(() => 2_039_280n),
    solanaRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]),
  ]);
  const needSol = SOL_FEE_LAMPORTS + (destInfo.value == null ? rent : 0n);
  if (sol < needSol) {
    throw new Error(destInfo.value == null
      ? 'Not enough SOL for the network fee and a new token account for the recipient.'
      : 'Not enough SOL for the network fee.');
  }
  const message = splPaymentMessage({
    payer: owner.publicKey,
    source: base58.decode(source.address),
    destOwner: base58.decode(destination),
    destAta: base58.decode(destAta),
    mint: base58.decode(input.mint),
    amount: rawAmount,
    decimals: input.decimals,
    blockhash: base58.decode(latest.value.blockhash),
    tokenProgram: programId ? base58.decode(programId) : undefined,
  });
  const signed = await signSolanaTransaction(concat([compactU16(1), new Uint8Array(64), message]), owner.address);
  return { signature: await sendRawSolana(signed) };
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

export type SwapAsset = {
  symbol: string;
  /** Wrapped SOL mint when this is native SOL. */
  mint: string;
  decimals: number;
  native: boolean;
};

export function formatAssetAmount(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

/** Jupiter quote for any two mints on Solana. Native SOL uses the wrapped SOL mint. */
export async function quoteSwapAssets(
  pay: SwapAsset,
  receive: SwapAsset,
  amount: bigint,
  slippageBps: number,
): Promise<SwapQuote> {
  if (pay.mint === receive.mint) throw new Error('Choose two different assets.');
  const params = new URLSearchParams({
    inputMint: pay.mint,
    outputMint: receive.mint,
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
  const outAmount = BigInt(raw.outAmount);
  return {
    raw,
    outAmount,
    outText: formatAssetAmount(outAmount, receive.decimals),
    impactPct: raw.priceImpactPct || '0',
    route: labels.length ? labels.join(' → ') : 'Jupiter',
    minimumText: formatAssetAmount(BigInt(raw.otherAmountThreshold || raw.outAmount), receive.decimals),
  };
}

export async function quoteSwap(
  pay: SwapSide,
  receive: SwapSide,
  amount: bigint,
  slippageBps: number,
): Promise<SwapQuote> {
  return quoteSwapAssets(
    { symbol: pay, mint: mintOf(pay), decimals: decimalsOf(pay), native: pay === 'SOL' },
    { symbol: receive, mint: mintOf(receive), decimals: decimalsOf(receive), native: receive === 'SOL' },
    amount,
    slippageBps,
  );
}

export async function executeSwap(owner: string, quote: JupiterQuote): Promise<{ signature: string }> {
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
  const signed = await signSolanaTransaction(raw, owner);
  const signature = await sendRawSolana(signed);
  return { signature };
}


