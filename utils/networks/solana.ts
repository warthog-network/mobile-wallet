import { base58, base64 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { getSessionMnemonic } from '../sessionVault';
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
export function buildSolTransfer(input: {
  from: Uint8Array;
  to: Uint8Array;
  lamports: bigint;
  blockhash: Uint8Array;
  privateKey: Uint8Array;
}): Uint8Array {
  const data = concat(Uint8Array.from([2, 0, 0, 0]), u64le(input.lamports));
  const message = concat(
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
  const signature = ed25519.sign(message, input.privateKey);
  return concat(compactU16(1), signature, message);
}

function requirePhraseKeys() {
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) {
    throw new Error('Solana sends need the recovery phrase. A Ledger or a private-key import cannot sign Solana here.');
  }
  return deriveChainKeys(mnemonic);
}

export async function sendSol(to: string, amount: string): Promise<{ signature: string }> {
  const keys = requirePhraseKeys();
  try {
    const from = base58.decode(keys.solAddress);
    const destination = assertSolAddress(to);
    if (base58.encode(destination) === keys.solAddress) {
      throw new Error('That is this wallet’s Solana address.');
    }
    const lamports = parseSol(amount);
    const balance = await fetchSolBalance(keys.solAddress);
    if (lamports + SOL_FEE_LAMPORTS > balance) {
      throw new Error('Not enough SOL for that amount and the network fee.');
    }
    const latest = await solanaRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [
      { commitment: 'confirmed' },
    ]);
    const raw = buildSolTransfer({
      from,
      to: destination,
      lamports,
      blockhash: base58.decode(latest.value.blockhash),
      privateKey: keys.solPrivateKey,
    });
    const signature = await sendRawSolana(raw);
    return { signature };
  } finally {
    keys.btcPrivateKey.fill(0);
    keys.solPrivateKey.fill(0);
  }
}

export function solTxUrl(signature: string): string {
  return `${SOLANA_EXPLORER}/tx/${signature}`;
}
