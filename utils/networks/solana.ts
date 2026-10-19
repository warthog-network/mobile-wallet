import { base58, base64 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { ethers } from 'ethers';
import { signSolanaOnLedger } from '../ledger/solana';
import { getLedgerSession, getSessionMnemonic } from '../sessionVault';
import { SOL_DECIMALS, SOL_FEE_LAMPORTS, SOLANA_EXPLORER, SOLANA_RPCS } from './chains';
import { deriveChainKeys } from './derive';
import { networkFetch } from './http';
import { formatUnits, parseUnits } from './units';

const SYSTEM_PROGRAM = new Uint8Array(32);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
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

export function parseSol(amount: string): bigint {
  return parseUnits(amount, SOL_DECIMALS, 'SOL');
}

export function formatSol(lamports: bigint): string {
  return formatUnits(lamports, SOL_DECIMALS);
}

export function assertSolAddress(address: string): Uint8Array {
  const text = address.trim();
  let raw: Uint8Array;
  try {
    raw = base58.decode(text);
  } catch {
    throw new Error('Enter a Solana address.');
  }
  if (raw.length !== 32) throw new Error('Enter a Solana address.');
  return raw;
}

export async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: Error = new Error('Solana did not answer.');
  for (const url of SOLANA_RPCS) {
    try {
      const res = await networkFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) {
        last = new Error('Solana did not answer.');
        continue;
      }
      const body = (await res.json()) as { result?: T; error?: { message?: string } };
      if (body.error) {
        const message = body.error.message || 'Solana rejected the request.';
        if (/insufficient|invalid|signature|debit|rent|already processed/i.test(message)) {
          throw new Error(message);
        }
        last = new Error(message);
        continue;
      }
      if (body.result === undefined) throw new Error('Solana returned an empty result.');
      return body.result;
    } catch (err) {
      if (err instanceof Error && /rejected|empty result/i.test(err.message)) throw err;
      last = err instanceof Error ? err : last;
    }
  }
  throw last;
}

function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length && shift <= 14) {
    const elem = bytes[index];
    index += 1;
    value |= (elem & 0x7f) << shift;
    if ((elem & 0x80) === 0) return { value, next: index };
    shift += 7;
  }
  throw new Error('Bad Solana transaction.');
}

/** Fill the first signature slot. Jupiter returns that slot as zeros. */
export function signVersionedTransaction(raw: Uint8Array, privateKey: Uint8Array): Uint8Array {
  const count = readCompactU16(raw, 0);
  if (count.value < 1) throw new Error('This Solana transaction has no signature slot.');
  const messageAt = count.next + count.value * 64;
  if (messageAt >= raw.length) throw new Error('This Solana transaction is too short.');
  const signature = ed25519.sign(raw.subarray(messageAt), privateKey);
  const signed = new Uint8Array(raw);
  signed.set(signature, count.next);
  return signed;
}

async function signSolanaMessage(message: Uint8Array, owner: string): Promise<Uint8Array> {
  const ledger = getLedgerSession();
  if (ledger) {
    if (!ledger.solAddress || !ledger.solPublicKey) {
      throw new Error('Add the Solana account from the home screen. Open the Solana app on the Ledger.');
    }
    if (ledger.solAddress !== owner) throw new Error('This Solana account is not unlocked.');
    const publicKey = ethers.getBytes(`0x${ledger.solPublicKey}`);
    if (base58.encode(publicKey) !== owner) throw new Error('This Solana account is not unlocked.');
    return signSolanaOnLedger(message, publicKey);
  }
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) {
    throw new Error('Solana sends need the recovery phrase. A private-key import cannot sign Solana.');
  }
  const keys = deriveChainKeys(mnemonic);
  try {
    if (keys.solAddress !== owner) throw new Error('This Solana account is not unlocked.');
    return ed25519.sign(message, keys.solPrivateKey);
  } finally {
    keys.btcPrivateKey.fill(0);
    keys.solPrivateKey.fill(0);
  }
}

/** Sign the one slot that belongs to this wallet. A Ledger signs in the Solana app. */
export async function signSolanaTransaction(raw: Uint8Array, owner: string): Promise<Uint8Array> {
  assertOwnSolanaTransaction(raw, owner);
  const count = readCompactU16(raw, 0);
  const messageAt = count.next + 64;
  const signature = await signSolanaMessage(raw.subarray(messageAt), owner);
  const signed = new Uint8Array(raw);
  signed.set(signature, count.next);
  return signed;
}

/** Reject a swap transaction that is not a single signature by this wallet. */
export function assertOwnSolanaTransaction(raw: Uint8Array, owner: string): void {
  if (raw.length < 1 + 64 + 35 || raw.length > 1232) {
    throw new Error('This Solana swap transaction is the wrong size.');
  }
  const count = readCompactU16(raw, 0);
  if (count.value !== 1) throw new Error('This Solana swap needs more than one signature.');
  let cursor = count.next + 64;
  if (raw[cursor] & 0x80) cursor += 1;
  const required = raw[cursor];
  cursor += 3;
  if (required !== 1) throw new Error('This Solana swap needs more than one signature.');
  const keys = readCompactU16(raw, cursor);
  if (keys.value < 1 || keys.next + 32 > raw.length) throw new Error('This Solana swap has no accounts.');
  const feePayer = base58.encode(raw.subarray(keys.next, keys.next + 32));
  if (feePayer !== owner) throw new Error('This Solana swap is not for this wallet.');
}

export async function sendRawSolana(raw: Uint8Array): Promise<string> {
  return solanaRpc<string>('sendTransaction', [
    base64.encode(raw),
    { encoding: 'base64', preflightCommitment: 'confirmed' },
  ]);
}

export async function fetchSolBalance(address: string): Promise<bigint> {
  const result = await solanaRpc<{ value: number | string }>('getBalance', [address]);
  return BigInt(result.value);
}

export function maxSendableSol(lamports: bigint): bigint {
  return lamports > SOL_FEE_LAMPORTS ? lamports - SOL_FEE_LAMPORTS : 0n;
}

/**
 * Legacy SystemProgram.transfer. Account order is signer, recipient, system program.
 * The signed bytes match @solana/web3.js for the same key, amount, and blockhash.
 */
export function solTransferMessage(input: {
  from: Uint8Array;
  to: Uint8Array;
  lamports: bigint;
  blockhash: Uint8Array;
}): Uint8Array {
  const data = concat(Uint8Array.from([2, 0, 0, 0]), u64le(input.lamports));
  return concat(
    Uint8Array.from([1, 0, 1]),
    compactU16(3),
    input.from,
    input.to,
    SYSTEM_PROGRAM,
    input.blockhash,
    compactU16(1),
    Uint8Array.from([2]),
    compactU16(2),
    Uint8Array.from([0, 1]),
    compactU16(data.length),
    data,
  );
}

export function buildSolTransfer(input: {
  from: Uint8Array;
  to: Uint8Array;
  lamports: bigint;
  blockhash: Uint8Array;
  privateKey: Uint8Array;
}): Uint8Array {
  const message = solTransferMessage(input);
  const signature = ed25519.sign(message, input.privateKey);
  return concat(compactU16(1), signature, message);
}

function solOwner(): { address: string; publicKey: Uint8Array } {
  const ledger = getLedgerSession();
  if (ledger) {
    if (!ledger.solAddress || !ledger.solPublicKey) {
      throw new Error('Add the Solana account from the home screen. Open the Solana app on the Ledger.');
    }
    return { address: ledger.solAddress, publicKey: ethers.getBytes(`0x${ledger.solPublicKey}`) };
  }
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) {
    throw new Error('Solana sends need the recovery phrase. A private-key import cannot sign Solana.');
  }
  const keys = deriveChainKeys(mnemonic);
  const address = keys.solAddress;
  keys.btcPrivateKey.fill(0);
  keys.solPrivateKey.fill(0);
  return { address, publicKey: base58.decode(address) };
}

export async function sendSol(to: string, amount: string): Promise<{ signature: string }> {
  const owner = solOwner();
  const destination = assertSolAddress(to);
  if (base58.encode(destination) === owner.address) {
    throw new Error('That is this wallet’s Solana address.');
  }
  const lamports = parseSol(amount);
  const balance = await fetchSolBalance(owner.address);
  if (lamports + SOL_FEE_LAMPORTS > balance) {
    throw new Error('Not enough SOL for that amount and the network fee.');
  }
  const latest = await solanaRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [
    { commitment: 'confirmed' },
  ]);
  const message = solTransferMessage({
    from: owner.publicKey,
    to: destination,
    lamports,
    blockhash: base58.decode(latest.value.blockhash),
  });
  const signature = await signSolanaMessage(message, owner.address);
  const raw = concat(compactU16(1), signature, message);
  return { signature: await sendRawSolana(raw) };
}

export async function maxSolPayment(address: string, feeLamports = SOL_FEE_LAMPORTS): Promise<bigint> {
  const [balance, rentResult] = await Promise.all([
    fetchSolBalance(address),
    solanaRpc<number>('getMinimumBalanceForRentExemption', [0]).then(BigInt).catch(() => 890_880n),
  ]);
  const keep = feeLamports + rentResult;
  return balance > keep ? balance - keep : 0n;
}

export function solTxUrl(signature: string): string {
  return `${SOLANA_EXPLORER}/tx/${signature}`;
}
