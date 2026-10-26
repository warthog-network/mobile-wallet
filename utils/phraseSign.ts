/**
 * Derive a chain key, sign once, and wipe the derived bytes.
 * The caller passes the phrase. This module does not keep it.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { Transaction } from '@scure/btc-signer';
import { ethers } from 'ethers';
import { deriveEthAddress, deriveEthWallet } from './evmAddress';
import { deriveChainKeys } from './networks/derive';

export type ChainPublic = {
  ethAddress: string;
  btcAddress: string;
  btcPublicKey: string;
  solAddress: string;
};

function requireIndex(index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error('Invalid account index');
  }
  return index;
}

function wipe(bytes: Uint8Array | undefined): void {
  bytes?.fill(0);
}

export function publicChains(mnemonic: string, index: number): ChainPublic {
  const account = requireIndex(index);
  const keys = deriveChainKeys(mnemonic, account);
  try {
    return {
      ethAddress: deriveEthAddress(mnemonic, account),
      btcAddress: keys.btcAddress,
      btcPublicKey: ethers.hexlify(keys.btcPublicKey),
      solAddress: keys.solAddress,
    };
  } finally {
    wipe(keys.btcPrivateKey);
    wipe(keys.solPrivateKey);
  }
}

export function signEthereumPhrase(
  mnemonic: string,
  index: number,
  unsignedSerialized: string,
): string {
  const wallet = deriveEthWallet(mnemonic, requireIndex(index));
  const tx = ethers.Transaction.from(unsignedSerialized);
  tx.signature = wallet.signingKey.sign(tx.unsignedHash);
  const signature = tx.signature?.serialized;
  if (!signature) throw new Error('Could not sign the Ethereum transaction.');
  return signature;
}

export function signSolanaPhrase(
  mnemonic: string,
  index: number,
  message: Uint8Array,
): Uint8Array {
  const keys = deriveChainKeys(mnemonic, requireIndex(index));
  try {
    return ed25519.sign(message, keys.solPrivateKey);
  } finally {
    wipe(keys.btcPrivateKey);
    wipe(keys.solPrivateKey);
  }
}

export function signBitcoinPhrase(
  mnemonic: string,
  index: number,
  psbt: Uint8Array,
): { hex: string; txid: string } {
  const keys = deriveChainKeys(mnemonic, requireIndex(index));
  try {
    const tx = Transaction.fromPSBT(psbt, { allowUnknownOutputs: true });
    tx.sign(keys.btcPrivateKey);
    tx.finalize();
    return { hex: tx.hex, txid: tx.id };
  } finally {
    wipe(keys.btcPrivateKey);
    wipe(keys.solPrivateKey);
  }
}
