/**
 * SLIP-0010 hardened ed25519 derivation.
 * Solana wallets use this. secp256k1 BIP32 cannot produce the same key.
 */
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';

const ED25519_SEED = new TextEncoder().encode('ed25519 seed');
const HARDENED = 0x80000000;

type Node = { key: Uint8Array; chain: Uint8Array };

function hmac512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data);
}

function master(seed: Uint8Array): Node {
  const digest = hmac512(ED25519_SEED, seed);
  return { key: digest.slice(0, 32), chain: digest.slice(32) };
}

function child(parent: Node, index: number): Node {
  if (index < HARDENED) throw new Error('Solana derivation only uses hardened steps.');
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0;
  data.set(parent.key, 1);
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;
  const digest = hmac512(parent.chain, data);
  return { key: digest.slice(0, 32), chain: digest.slice(32) };
}

/** 32-byte ed25519 private key at `path`, for example m/44'/501'/0'/0'. */
export function slip10Derive(seed: Uint8Array, path: string): Uint8Array {
  const parts = path.trim().split('/');
  if (parts[0] !== 'm' || parts.length < 2) throw new Error('Bad derivation path.');
  let node = master(seed);
  for (const part of parts.slice(1)) {
    const hardened = part.endsWith("'") || part.endsWith('h');
    const raw = hardened ? part.slice(0, -1) : part;
    if (!/^\d+$/.test(raw)) throw new Error('Bad derivation path.');
    const index = Number(raw);
    if (!Number.isSafeInteger(index) || index >= HARDENED) throw new Error('Bad derivation path.');
    node = child(node, hardened ? index + HARDENED : index);
  }
  return node.key;
}
