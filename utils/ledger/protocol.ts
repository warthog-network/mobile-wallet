/**
 * Warthog Nano app (version 0.1.0), transport-agnostic.
 *
 * GET_PUBLIC_KEY 0x05 shows the 48-character address and returns the
 * uncompressed public key. SIGN_TX 0x06 accepts one WART transfer and
 * returns signature65. The device keeps the private key.
 */
import { ethers } from 'ethers';
import type { TransactionJson } from 'warthog-ts';
import { isDefiNode } from '../nodes';

const GET_PUBLIC_KEY = 0x05;
const SIGN_TX = 0x06;
const P1_START = 0x00;
const P2_MORE = 0x80;
const P2_LAST = 0x00;
const HARDENED = 0x80000000;

export const LEDGER_DEFI_HOLD =
  'This Nano signs WART sends on the DeFi testnet. Swap, liquidity, and mint need a software wallet.';

export type LedgerPathType = 'hardened' | 'normal';

export interface LedgerSession {
  address: string;
  publicKey: string;
  pathType: LedgerPathType;
  index: number;
  name: string;
  /** Ethereum account 1 for this seed, after the Ethereum app has approved it. */
  ethAddress?: string;
  /** Native segwit account 1, after the Bitcoin app has approved it. */
  btcAddress?: string;
  /** Compressed public key for that Bitcoin address. Hex, no 0x. */
  btcPublicKey?: string;
  /** BIP32 master fingerprint, 8 hex characters. */
  btcFingerprint?: string;
  /** Account xpub at m/84'/0'/0'. The phone cannot spend from it. */
  btcAccountXpub?: string;
  /** Solana account 0, after the Solana app has approved it. */
  solAddress?: string;
  /** 32-byte Solana public key. Hex, no 0x. */
  solPublicKey?: string;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export type LedgerAppName = 'warthog' | 'ethereum' | 'bitcoin' | 'solana';

export function statusMessage(sw: number, app: LedgerAppName = 'warthog'): string {
  if (sw === 0x6985) return 'Rejected on the Ledger';
  if (sw === 0x6808 && app === 'solana') {
    return 'Turn on Blind signing in the Solana app, then try this again';
  }
  if (sw === 0x6e00 || sw === 0x6d00) {
    if (app === 'ethereum') return 'Open the Ethereum app on the Ledger, then try again';
    if (app === 'bitcoin') return 'Open the Bitcoin app on the Ledger, then try again';
    if (app === 'solana') return 'Open the Solana app on the Ledger, then try again';
    return 'Open the Warthog app on the Ledger, then try again';
  }
  if (sw === 0x6a80 || sw === 0x6984) {
    if (app === 'ethereum') return 'Turn on Blind signing in the Ethereum app, then try this again';
    if (app === 'bitcoin') return 'The Bitcoin app refused this transaction.';
    if (app === 'solana') return 'The Solana app refused this transaction.';
    return 'The Ledger refused this data. Stay on a WART transfer.';
  }
  return `Ledger status 0x${sw.toString(16).padStart(4, '0')}`;
}

export function ledgerPath(pathType: LedgerPathType, index: number): number[] {
  const account = pathType === 'hardened' ? HARDENED : 0;
  return [HARDENED | 44, HARDENED | 2070, account, 0, index >>> 0];
}

export function encodePath(path: number[]): Uint8Array {
  const out = new Uint8Array(1 + path.length * 4);
  out[0] = path.length;
  const view = new DataView(out.buffer);
  path.forEach((component, i) => view.setUint32(1 + i * 4, component, false));
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new LedgerError('Expected hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same address the device shows: RIPEMD160(SHA256(compressed key)) plus 4 checksum bytes. */
export function wartAddressFromUncompressed(publicKey: Uint8Array): string {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new LedgerError('Ledger returned a public key this wallet cannot use');
  }
  const compressed = new Uint8Array(33);
  compressed[0] = (publicKey[64] & 1) === 1 ? 0x03 : 0x02;
  compressed.set(publicKey.subarray(1, 33), 1);
  const sha = ethers.getBytes(ethers.sha256(compressed));
  const ripe = ethers.getBytes(ethers.ripemd160(sha));
  const checksum = ethers.getBytes(ethers.sha256(ripe)).subarray(0, 4);
  const full = new Uint8Array(24);
  full.set(ripe, 0);
  full.set(checksum, 20);
  return ethers.hexlify(full).slice(2);
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Bytes the device parses: pinHash || height || nonce || 3 zero bytes || fee || to || amount. */
export function wartTransferBytes(input: {
  pinHash: string;
  pinHeight: number;
  nonceId: number;
  feeE8: bigint;
  toAddress: string;
  amountE8: bigint;
}): Uint8Array {
  const pin = hexToBytes(input.pinHash);
  if (pin.length !== 32) {
    throw new LedgerError('This Ledger app expects a 32-byte chain pin');
  }
  const to = hexToBytes(input.toAddress);
  if (to.length !== 24) {
    throw new LedgerError('Recipient must be a 48-character Warthog address');
  }
  return concat([
    pin,
    u32(input.pinHeight),
    u32(input.nonceId),
    new Uint8Array(3),
    u64(input.feeE8),
    to.subarray(0, 20),
    u64(input.amountE8),
  ]);
}

export function apduWithCla(cla: number, ins: number, p1: number, p2: number, data: Uint8Array): Uint8Array {
  if (data.length > 255) {
    throw new LedgerError('Ledger command is too long');
  }
  const out = new Uint8Array(5 + data.length);
  out[0] = cla;
  out[1] = ins;
  out[2] = p1;
  out[3] = p2;
  out[4] = data.length;
  out.set(data, 5);
  return out;
}

export function apdu(ins: number, p1: number, p2: number, data: Uint8Array): Uint8Array {
  return apduWithCla(0xe0, ins, p1, p2, data);
}

export interface LedgerIo {
  write(packet: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

const PACKET = 64;
const CHANNEL = 0x0101;
const TAG = 0x05;

async function writeApdu(io: LedgerIo, apduBytes: Uint8Array): Promise<void> {
  let seq = 0;
  let offset = 0;
  while (offset < apduBytes.length || seq === 0) {
    const buf = new Uint8Array(PACKET);
    buf[0] = (CHANNEL >> 8) & 0xff;
    buf[1] = CHANNEL & 0xff;
    buf[2] = TAG;
    buf[3] = (seq >> 8) & 0xff;
    buf[4] = seq & 0xff;
    let dataOff = 5;
    if (seq === 0) {
      buf[5] = (apduBytes.length >> 8) & 0xff;
      buf[6] = apduBytes.length & 0xff;
      dataOff = 7;
    }
    const take = Math.min(PACKET - dataOff, apduBytes.length - offset);
    buf.set(apduBytes.subarray(offset, offset + take), dataOff);
    offset += take;
    await io.write(buf);
    seq += 1;
    if (offset >= apduBytes.length) break;
  }
}

async function readApdu(io: LedgerIo, timeoutMs: number): Promise<Uint8Array> {
  const first = await io.read(timeoutMs);
  if (first.length < 7 || first[2] !== TAG) {
    throw new LedgerError('Unexpected reply from the Ledger');
  }
  const total = (first[5] << 8) | first[6];
  const payload = new Uint8Array(total);
  const firstChunk = first.subarray(7, 7 + Math.min(first.length - 7, total));
  payload.set(firstChunk);
  let filled = firstChunk.length;
  while (filled < total) {
    const frame = await io.read(timeoutMs);
    const part = frame.subarray(5);
    const take = Math.min(part.length, total - filled);
    payload.set(part.subarray(0, take), filled);
    filled += take;
  }
  return payload;
}

export async function exchangeApduResult(
  io: LedgerIo,
  command: Uint8Array,
  timeoutMs: number,
): Promise<{ data: Uint8Array; sw: number }> {
  await writeApdu(io, command);
  const payload = await readApdu(io, timeoutMs);
  if (payload.length < 2) {
    throw new LedgerError('Short reply from the Ledger');
  }
  const sw = (payload[payload.length - 2] << 8) | payload[payload.length - 1];
  return { data: payload.subarray(0, payload.length - 2), sw };
}

export async function exchangeApdu(
  io: LedgerIo,
  command: Uint8Array,
  timeoutMs: number,
  app: LedgerAppName = 'warthog',
): Promise<Uint8Array> {
  const result = await exchangeApduResult(io, command, timeoutMs);
  if (result.sw !== 0x9000) {
    throw new LedgerError(statusMessage(result.sw, app));
  }
  return result.data;
}

const ETH_GET_PUBLIC_KEY = 0x02;
const ETH_SIGN = 0x04;
const ETH_CHUNK = 150;

/** Ledger Live account 1. The Warthog app rejects this path. */
export function ethAccountPath(): number[] {
  return [HARDENED | 44, HARDENED | 60, HARDENED | 0, 0, 0];
}

export function ethPublicKeyCommand(): Uint8Array {
  return apdu(ETH_GET_PUBLIC_KEY, 0x01, 0x00, encodePath(ethAccountPath()));
}

/** Public key, then the ASCII address the Ethereum app displayed. */
export function parseEthPublicKey(data: Uint8Array): string {
  if (data.length < 67 || data[0] !== 65 || data[1] !== 0x04) {
    throw new LedgerError('Ledger did not return an Ethereum public key');
  }
  const publicKey = data.subarray(1, 66);
  const addressLen = data[66];
  if (addressLen < 40 || data.length < 67 + addressLen) {
    throw new LedgerError('Ledger did not return an Ethereum address');
  }
  const ascii = new TextDecoder().decode(data.subarray(67, 67 + addressLen)).trim();
  const hex = ascii.startsWith('0x') || ascii.startsWith('0X') ? ascii : `0x${ascii}`;
  let address: string;
  try {
    address = ethers.getAddress(hex);
  } catch {
    throw new LedgerError('Ledger returned an Ethereum address this wallet cannot use');
  }
  if (ethers.computeAddress(ethers.hexlify(publicKey)).toLowerCase() !== address.toLowerCase()) {
    throw new LedgerError('Ledger returned an Ethereum address this wallet cannot use');
  }
  return address;
}

/**
 * First APDU is the path plus the start of the unsigned type-2 transaction.
 * Later APDUs continue those bytes. P1 is 0x00, then 0x80.
 */
export function ethSignCommands(rawTx: Uint8Array): Uint8Array[] {
  if (rawTx.length === 0 || rawTx[0] !== 0x02) {
    throw new LedgerError('This wallet signs Ethereum transactions as type 2');
  }
  const path = encodePath(ethAccountPath());
  const commands: Uint8Array[] = [];
  let offset = 0;
  let first = true;
  while (first || offset < rawTx.length) {
    const room = first ? ETH_CHUNK - path.length : ETH_CHUNK;
    const take = Math.min(room, rawTx.length - offset);
    const data = new Uint8Array((first ? path.length : 0) + take);
    if (first) data.set(path, 0);
    data.set(rawTx.subarray(offset, offset + take), first ? path.length : 0);
    commands.push(apdu(ETH_SIGN, first ? 0x00 : 0x80, 0x00, data));
    offset += take;
    first = false;
    if (offset >= rawTx.length) break;
  }
  return commands;
}

/** Ledger returns v || r || s. Type-2 signatures use v 0 or 1. */
export function ethYParity(v: number): 0 | 1 {
  if (v === 0 || v === 1) return v;
  if (v === 27 || v === 28) return (v - 27) as 0 | 1;
  if (v === 37 || v === 38) return (v - 37) as 0 | 1;
  throw new LedgerError('Ledger returned a signature this wallet cannot use');
}

export function parseEthSignature(data: Uint8Array): { yParity: 0 | 1; r: string; s: string } {
  if (data.length < 65) throw new LedgerError('Ledger did not return a signature');
  return {
    yParity: ethYParity(data[0]),
    r: ethers.hexlify(data.subarray(1, 33)),
    s: ethers.hexlify(data.subarray(33, 65)),
  };
}

const SOL_GET_ADDR = 0x05;
const SOL_SIGN = 0x06;
const SOL_CONFIRM = 0x01;
const SOL_EXTEND = 0x01;
const SOL_MORE = 0x02;

/** Phantom and Backpack account 0. Every step is hardened. */
export function solAccountPath(): number[] {
  return [HARDENED | 44, HARDENED | 501, HARDENED | 0, HARDENED | 0];
}

/** Show m/44'/501'/0'/0' on the Solana app. The reply is the 32-byte public key. */
export function solPublicKeyCommand(): Uint8Array {
  return apdu(SOL_GET_ADDR, SOL_CONFIRM, 0x00, encodePath(solAccountPath()));
}

/**
 * Sign one Solana message. The payload is one path, then the message.
 * Chunks over 255 bytes use the Solana app's MORE and EXTEND flags.
 */
export function solSignCommands(message: Uint8Array): Uint8Array[] {
  if (message.length === 0 || message.length > 1232) {
    throw new LedgerError('This Solana transaction is the wrong size.');
  }
  const path = encodePath(solAccountPath());
  const payload = new Uint8Array(1 + path.length + message.length);
  payload[0] = 1;
  payload.set(path, 1);
  payload.set(message, 1 + path.length);
  const commands: Uint8Array[] = [];
  let offset = 0;
  let p2 = 0;
  while (payload.length - offset > 255) {
    commands.push(apdu(SOL_SIGN, SOL_CONFIRM, p2 | SOL_MORE, payload.subarray(offset, offset + 255)));
    offset += 255;
    p2 |= SOL_EXTEND;
  }
  commands.push(apdu(SOL_SIGN, SOL_CONFIRM, p2, payload.subarray(offset)));
  return commands;
}

export function parseSolPublicKey(data: Uint8Array): Uint8Array {
  if (data.length !== 32) throw new LedgerError('Ledger did not return a Solana public key');
  return data;
}

export function publicKeyCommand(pathType: LedgerPathType, index: number): Uint8Array {
  return apdu(GET_PUBLIC_KEY, 0x01, 0x00, encodePath(ledgerPath(pathType, index)));
}

export function signCommands(
  pathType: LedgerPathType,
  index: number,
  raw: Uint8Array,
): [Uint8Array, Uint8Array] {
  const path = encodePath(ledgerPath(pathType, index));
  return [
    apdu(SIGN_TX, P1_START, P2_MORE, path),
    apdu(SIGN_TX, 0x01, P2_LAST, raw),
  ];
}

/**
 * Mainnet reads amountE8. The DeFi testnet reads wartE8 plus type.
 * The Nano signs the same 79 bytes either way. Sending wartE8 to mainnet
 * comes back as "invalid amount".
 */
export function ledgerWartSubmitJson(
  signed: TransactionJson,
  nodeUrl: string | null | undefined,
): TransactionJson {
  const feeE8 = Number(signed.feeE8);
  const amountE8 = Number(signed.wartE8 ?? signed.amountE8);
  if (!Number.isSafeInteger(feeE8) || !Number.isSafeInteger(amountE8) || amountE8 < 0) {
    throw new LedgerError('Amount is too large to submit');
  }
  const pinHeight = Number(signed.pinHeight);
  const nonceId = Number(signed.nonceId);
  const toAddr = String(signed.toAddr || '');
  const signature65 = String(signed.signature65 || '');
  if (isDefiNode(nodeUrl || '')) {
    return {
      type: 'wartTransfer',
      pinHeight,
      nonceId,
      feeE8,
      toAddr,
      wartE8: amountE8,
      signature65,
    };
  }
  return {
    pinHeight,
    nonceId,
    toAddr,
    amountE8,
    feeE8,
    signature65,
  } as unknown as TransactionJson;
}
