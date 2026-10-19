/**
 * Ledger Bitcoin app 2.1+ (CLA 0xE1).
 * The bytes follow Ledger's client: wallet policy wpkh(@0/**),
 * merkleized PSBT v2, and the client-command loop.
 * https://github.com/LedgerHQ/app-bitcoin-new/blob/master/doc/bitcoin.md
 */
import { ethers } from 'ethers';
import { apduWithCla, LedgerError } from './protocol';

const CLA_BITCOIN = 0xe1;
const CLA_FRAMEWORK = 0xf8;
const P2_VERSION = 0x01;
const NIL = new Uint8Array(32);

const INS_EXTENDED_PUBKEY = 0x00;
const INS_WALLET_ADDRESS = 0x03;
const INS_SIGN_PSBT = 0x04;
const INS_FINGERPRINT = 0x05;
const INS_CONTINUE = 0x01;

const CMD_YIELD = 0x10;
const CMD_PREIMAGE = 0x40;
const CMD_LEAF_PROOF = 0x41;
const CMD_LEAF_INDEX = 0x42;
const CMD_MORE = 0xa0;

export const BTC_ACCOUNT_PATH = "m/84'/0'/0'";
/** Full master path of receive address 0. Same native-segwit path a phrase wallet uses. */
export const BTC_ADDRESS_PATH = [0x80000000 + 84, 0x80000000, 0x80000000, 0, 0];

function sha256(data: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.sha256(data));
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

function hexKey(bytes: Uint8Array): string {
  return ethers.hexlify(bytes).slice(2);
}

export function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export function writeVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new LedgerError('Bad Bitcoin length');
  if (value <= 0xfc) return Uint8Array.of(value);
  if (value <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 0xfd;
    out[1] = value & 0xff;
    out[2] = (value >> 8) & 0xff;
    return out;
  }
  const out = new Uint8Array(5);
  out[0] = 0xfe;
  new DataView(out.buffer).setUint32(1, value, true);
  return out;
}

export function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  if (offset >= bytes.length) throw new LedgerError('Short Bitcoin reply');
  const prefix = bytes[offset];
  if (prefix < 0xfd) return { value: prefix, next: offset + 1 };
  const size = prefix === 0xfd ? 2 : prefix === 0xfe ? 4 : 8;
  if (offset + 1 + size > bytes.length) throw new LedgerError('Short Bitcoin reply');
  let value = 0;
  for (let i = 0; i < size; i += 1) value += bytes[offset + 1 + i] * (256 ** i);
  if (!Number.isSafeInteger(value)) throw new LedgerError('Bitcoin length is too large');
  return { value, next: offset + 1 + size };
}

function readBytes(bytes: Uint8Array, offset: number, length: number): { value: Uint8Array; next: number } {
  if (offset + length > bytes.length) throw new LedgerError('Short Bitcoin reply');
  return { value: bytes.subarray(offset, offset + length), next: offset + length };
}

/** SHA256(0x00 || leaf). Internal nodes are SHA256(0x01 || left || right). */
export function elementHash(preimage: Uint8Array): Uint8Array {
  const prefixed = new Uint8Array(1 + preimage.length);
  prefixed[0] = 0x00;
  prefixed.set(preimage, 1);
  return sha256(prefixed);
}

function combineHashes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const body = new Uint8Array(65);
  body[0] = 0x01;
  body.set(left, 1);
  body.set(right, 33);
  return sha256(body);
}

type Node = {
  left: Node | null;
  right: Node | null;
  parent: Node | null;
  value: Uint8Array;
};

function largestPowerOf2LessThan(size: number): number {
  if (size <= 1) throw new LedgerError('Bad Bitcoin tree');
  let power = 1;
  while (power * 2 < size) power *= 2;
  return power;
}

function makeTree(leaves: Node[], begin: number, size: number): Node {
  if (size === 1) return leaves[begin];
  const leftSize = largestPowerOf2LessThan(size);
  const left = makeTree(leaves, begin, leftSize);
  const right = makeTree(leaves, begin + leftSize, size - leftSize);
  const root: Node = { left, right, parent: null, value: combineHashes(left.value, right.value) };
  left.parent = root;
  right.parent = root;
  return root;
}

export class MerkleTree {
  private readonly leaves: Node[];
  private readonly rootNode: Node | null;

  constructor(elements: Uint8Array[]) {
    this.leaves = elements.map((value) => ({ left: null, right: null, parent: null, value }));
    this.rootNode = this.leaves.length === 0 ? null : makeTree(this.leaves, 0, this.leaves.length);
  }

  get length(): number {
    return this.leaves.length;
  }

  get root(): Uint8Array {
    return this.rootNode ? this.rootNode.value : NIL;
  }

  get(index: number): Uint8Array {
    if (index < 0 || index >= this.leaves.length) throw new LedgerError('Bitcoin proof is out of range');
    return this.leaves[index].value;
  }

  leafIndex(hash: Uint8Array): number | null {
    for (let i = 0; i < this.leaves.length; i += 1) {
      if (compareBytes(this.leaves[i].value, hash) === 0) return i;
    }
    return null;
  }

  prove(index: number): Uint8Array[] {
    const start = this.leaves[index];
    if (!start) throw new LedgerError('Bitcoin proof is out of range');
    const proof: Uint8Array[] = [];
    let node: Node = start;
    while (node.parent) {
      const parent: Node = node.parent;
      const sibling = parent.left === node ? parent.right : parent.left;
      if (!sibling) throw new LedgerError('Bitcoin proof is incomplete');
      proof.push(sibling.value);
      node = parent;
    }
    return proof;
  }
}

export function merkleizedMap(mapping: Map<string, { key: Uint8Array; value: Uint8Array }>): Uint8Array {
  const items = [...mapping.values()].sort((a, b) => compareBytes(a.key, b.key));
  const keys = new MerkleTree(items.map((item) => elementHash(item.key)));
  const values = new MerkleTree(items.map((item) => elementHash(item.value)));
  return concat([writeVarint(items.length), keys.root, values.root]);
}

export type BitcoinPolicy = {
  template: string;
  keys: string[];
  serialized: Uint8Array;
  id: Uint8Array;
};

/** Default native-segwit policy. Empty name, one account xpub, no registration. */
export function nativeSegwitPolicy(fingerprintHex: string, xpub: string): BitcoinPolicy {
  const fingerprint = fingerprintHex.toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) throw new LedgerError('Ledger returned a Bitcoin fingerprint this wallet cannot use');
  if (!xpub.startsWith('xpub')) throw new LedgerError('Ledger returned a Bitcoin key this wallet cannot use');
  const template = 'wpkh(@0/**)';
  const keys = [`[${fingerprint}/84'/0'/0']${xpub}`];
  const templateBytes = new TextEncoder().encode(template);
  const keyBytes = keys.map((key) => new TextEncoder().encode(key));
  const tree = new MerkleTree(keyBytes.map((key) => elementHash(key)));
  const serialized = concat([
    Uint8Array.of(0x02, 0x00),
    writeVarint(templateBytes.length),
    sha256(templateBytes),
    writeVarint(keys.length),
    tree.root,
  ]);
  return { template, keys, serialized, id: sha256(serialized) };
}

function command(cla: number, ins: number, data: Uint8Array): Uint8Array {
  return apduWithCla(cla, ins, 0x00, P2_VERSION, data);
}

function pathSteps(path: string): Uint8Array {
  const parts = path.split('/').filter((part) => part && part !== 'm');
  const out = new Uint8Array(1 + parts.length * 4);
  out[0] = parts.length;
  const view = new DataView(out.buffer);
  parts.forEach((part, index) => {
    const hardened = part.endsWith("'") || part.endsWith('h');
    const text = hardened ? part.slice(0, -1) : part;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value >= 0x80000000) {
      throw new LedgerError('Bad Bitcoin path');
    }
    view.setUint32(1 + index * 4, hardened ? (0x80000000 + value) >>> 0 : value, false);
  });
  return out;
}

/** Read the account xpub. Display stays off. The address command is what the user confirms. */
export function bitcoinExtendedKeyCommand(path: string): Uint8Array {
  const steps = pathSteps(path);
  const data = new Uint8Array(1 + steps.length);
  data[0] = 0;
  data.set(steps, 1);
  return command(CLA_BITCOIN, INS_EXTENDED_PUBKEY, data);
}

export function bitcoinFingerprintCommand(): Uint8Array {
  return command(CLA_BITCOIN, INS_FINGERPRINT, new Uint8Array());
}

export function bitcoinAddressCommand(policy: BitcoinPolicy, display: boolean): Uint8Array {
  const data = new Uint8Array(1 + 32 + 32 + 1 + 4);
  data[0] = display ? 1 : 0;
  data.set(policy.id, 1);
  data[65] = 0;
  new DataView(data.buffer).setUint32(66, 0, false);
  return command(CLA_BITCOIN, INS_WALLET_ADDRESS, data);
}

export function bitcoinSignCommand(
  globalMap: Map<string, { key: Uint8Array; value: Uint8Array }>,
  inputMaps: Map<string, { key: Uint8Array; value: Uint8Array }>[],
  outputMaps: Map<string, { key: Uint8Array; value: Uint8Array }>[],
  policy: BitcoinPolicy,
): Uint8Array {
  const inputCommitments = inputMaps.map((item) => merkleizedMap(item));
  const outputCommitments = outputMaps.map((item) => merkleizedMap(item));
  return command(CLA_BITCOIN, INS_SIGN_PSBT, concat([
    merkleizedMap(globalMap),
    writeVarint(inputMaps.length),
    new MerkleTree(inputCommitments.map((item) => elementHash(item))).root,
    writeVarint(outputMaps.length),
    new MerkleTree(outputCommitments.map((item) => elementHash(item))).root,
    policy.id,
    new Uint8Array(32),
  ]));
}

export function bitcoinContinueCommand(data: Uint8Array): Uint8Array {
  return command(CLA_FRAMEWORK, INS_CONTINUE, data);
}

type TreeBook = Map<string, MerkleTree>;
type PreimageBook = Map<string, Uint8Array>;

export class BitcoinClient {
  private readonly preimages: PreimageBook = new Map();
  private readonly trees: TreeBook = new Map();
  private readonly queue: Uint8Array[] = [];
  readonly yielded: Uint8Array[] = [];

  addPreimage(element: Uint8Array): void {
    this.preimages.set(hexKey(sha256(element)), element);
  }

  addList(elements: Uint8Array[]): void {
    for (const element of elements) {
      const prefixed = new Uint8Array(1 + element.length);
      prefixed[0] = 0x00;
      prefixed.set(element, 1);
      this.addPreimage(prefixed);
    }
    const tree = new MerkleTree(elements.map((element) => elementHash(element)));
    this.trees.set(hexKey(tree.root), tree);
  }

  addMap(mapping: Map<string, { key: Uint8Array; value: Uint8Array }>): void {
    const items = [...mapping.values()].sort((a, b) => compareBytes(a.key, b.key));
    this.addList(items.map((item) => item.key));
    this.addList(items.map((item) => item.value));
  }

  addPolicy(policy: BitcoinPolicy): void {
    this.addPreimage(policy.serialized);
    this.addPreimage(new TextEncoder().encode(policy.template));
    this.addList(policy.keys.map((key) => new TextEncoder().encode(key)));
  }

  answer(request: Uint8Array): Uint8Array {
    if (request.length === 0) throw new LedgerError('The Bitcoin app stopped responding');
    const code = request[0];
    if (code === CMD_YIELD) {
      this.yielded.push(request.subarray(1));
      return new Uint8Array();
    }
    if (code === CMD_PREIMAGE) return this.preimage(request.subarray(1));
    if (code === CMD_LEAF_PROOF) return this.leafProof(request.subarray(1));
    if (code === CMD_LEAF_INDEX) return this.leafIndex(request.subarray(1));
    if (code === CMD_MORE) return this.more(request);
    throw new LedgerError('The Bitcoin app asked for something this wallet does not know');
  }

  private preimage(body: Uint8Array): Uint8Array {
    if (body[0] !== 0 || body.length !== 33) throw new LedgerError('The Bitcoin app asked for an unknown preimage');
    const found = this.preimages.get(hexKey(body.subarray(1)));
    if (!found) throw new LedgerError('The Bitcoin app asked for an unknown preimage');
    const length = writeVarint(found.length);
    const room = 255 - length.length - 1;
    const take = Math.min(room, found.length);
    if (take < found.length) {
      for (let i = take; i < found.length; i += 1) this.queue.push(found.subarray(i, i + 1));
    }
    return concat([length, Uint8Array.of(take), found.subarray(0, take)]);
  }

  private leafProof(body: Uint8Array): Uint8Array {
    const root = readBytes(body, 0, 32);
    const size = readVarint(body, root.next);
    const index = readVarint(body, size.next);
    if (index.next !== body.length) throw new LedgerError('The Bitcoin app asked for an unknown proof');
    const tree = this.trees.get(hexKey(root.value));
    if (!tree || tree.length !== size.value || index.value >= size.value) {
      throw new LedgerError('The Bitcoin app asked for an unknown proof');
    }
    if (this.queue.length !== 0) throw new LedgerError('The Bitcoin app asked for a proof out of order');
    const proof = tree.prove(index.value);
    const room = Math.min(Math.floor((255 - 32 - 2) / 32), proof.length);
    for (let i = room; i < proof.length; i += 1) this.queue.push(proof[i]);
    return concat([
      tree.get(index.value),
      Uint8Array.of(proof.length, room),
      ...proof.slice(0, room),
    ]);
  }

  private leafIndex(body: Uint8Array): Uint8Array {
    const root = readBytes(body, 0, 32);
    const leaf = readBytes(body, root.next, 32);
    if (leaf.next !== body.length) throw new LedgerError('The Bitcoin app asked for an unknown leaf');
    const tree = this.trees.get(hexKey(root.value));
    if (!tree) throw new LedgerError('The Bitcoin app asked for an unknown leaf');
    const index = tree.leafIndex(leaf.value);
    return concat([Uint8Array.of(index == null ? 0 : 1), writeVarint(index ?? 0)]);
  }

  private more(request: Uint8Array): Uint8Array {
    if (request.length !== 1 || this.queue.length === 0) throw new LedgerError('The Bitcoin app asked for more data than this wallet has');
    const width = this.queue[0].length;
    const packed: Uint8Array[] = [];
    let used = 0;
    while (this.queue.length > 0 && this.queue[0].length === width && used + width <= 253) {
      const next = this.queue.shift();
      if (!next) break;
      packed.push(next);
      used += width;
    }
    return concat([Uint8Array.of(packed.length, width), ...packed]);
  }
}

function readString(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const length = readVarint(bytes, offset);
  return readBytes(bytes, length.next, length.value);
}

function readMap(bytes: Uint8Array, offset: number): {
  map: Map<string, { key: Uint8Array; value: Uint8Array }>;
  next: number;
} {
  const map = new Map<string, { key: Uint8Array; value: Uint8Array }>();
  let cursor = offset;
  while (cursor < bytes.length) {
    const key = readString(bytes, cursor);
    if (key.value.length === 0) return { map, next: key.next };
    const value = readString(bytes, key.next);
    map.set(hexKey(key.value), { key: key.value, value: value.value });
    cursor = value.next;
  }
  throw new LedgerError('This Bitcoin transaction is incomplete');
}

function mapInt(map: Map<string, { key: Uint8Array; value: Uint8Array }>, key: number): number | null {
  const found = map.get(key.toString(16).padStart(2, '0'));
  if (!found) return null;
  return readVarint(found.value, 0).value;
}

/** Split a PSBT v2 into the global map and one map per input and output. */
export function parsePsbtMaps(raw: Uint8Array): {
  globalMap: Map<string, { key: Uint8Array; value: Uint8Array }>;
  inputMaps: Map<string, { key: Uint8Array; value: Uint8Array }>[];
  outputMaps: Map<string, { key: Uint8Array; value: Uint8Array }>[];
} {
  const magic = ethers.hexlify(raw.subarray(0, 5)).slice(2);
  if (magic !== '70736274ff') throw new LedgerError('This Bitcoin transaction is not a PSBT');
  const global = readMap(raw, 5);
  const inputs = mapInt(global.map, 0x04);
  const outputs = mapInt(global.map, 0x05);
  if (inputs == null || outputs == null) throw new LedgerError('This Bitcoin transaction is not version 2');
  const inputMaps = [];
  let cursor = global.next;
  for (let i = 0; i < inputs; i += 1) {
    const next = readMap(raw, cursor);
    inputMaps.push(next.map);
    cursor = next.next;
  }
  const outputMaps = [];
  for (let i = 0; i < outputs; i += 1) {
    const next = readMap(raw, cursor);
    outputMaps.push(next.map);
    cursor = next.next;
  }
  if (cursor !== raw.length) throw new LedgerError('This Bitcoin transaction has extra data');
  return { globalMap: global.map, inputMaps, outputMaps };
}

export type BitcoinPartialSignature = {
  inputIndex: number;
  publicKey: Uint8Array;
  signature: Uint8Array;
};

/** One ECDSA signature yielded by SIGN_PSBT. MuSig results are refused. */
export function parseYieldedSignature(raw: Uint8Array): BitcoinPartialSignature {
  const index = readVarint(raw, 0);
  if (index.value >= 0x80000000) throw new LedgerError('This wallet cannot use that Bitcoin signature');
  if (index.next >= raw.length) throw new LedgerError('Ledger did not return a Bitcoin signature');
  const length = raw[index.next];
  const keyAt = index.next + 1;
  if (length !== 33 || keyAt + length > raw.length) throw new LedgerError('Ledger did not return a Bitcoin signature');
  const signature = raw.subarray(keyAt + length);
  if (signature.length < 8) throw new LedgerError('Ledger did not return a Bitcoin signature');
  return {
    inputIndex: index.value,
    publicKey: raw.subarray(keyAt, keyAt + length),
    signature,
  };
}
