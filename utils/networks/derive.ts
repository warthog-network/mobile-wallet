import { HDKey } from '@scure/bip32';
import { NETWORK, p2wpkh } from '@scure/btc-signer';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { ethers } from 'ethers';
import { normalizeEthPhrase } from '../evmAddress';
import { BTC_PATH, SOL_PATH } from './chains';
import { slip10Derive } from './slip10';

export type ChainKeys = {
  btcAddress: string;
  btcPublicKey: Uint8Array;
  btcPrivateKey: Uint8Array;
  solAddress: string;
  solPrivateKey: Uint8Array;
};

function wipe(bytes: Uint8Array | undefined): void {
  bytes?.fill(0);
}

/** Bitcoin and Solana keys for a BIP39 phrase. Hemi is the Ethereum key. */
export function deriveChainKeys(mnemonic: string): ChainKeys {
  const phrase = normalizeEthPhrase(mnemonic);
  const seed = ethers.getBytes(ethers.Mnemonic.fromPhrase(phrase).computeSeed());
  const btc = HDKey.fromMasterSeed(seed).derive(BTC_PATH);
  if (!btc.privateKey || !btc.publicKey) throw new Error('Could not derive the Bitcoin key.');
  const payment = p2wpkh(btc.publicKey, NETWORK);
  if (!payment.address) throw new Error('Could not encode the Bitcoin address.');
  const solPrivateKey = slip10Derive(seed, SOL_PATH);
  const solPublic = ed25519.getPublicKey(solPrivateKey);
  seed.fill(0);
  return {
    btcAddress: payment.address,
    btcPublicKey: btc.publicKey,
    btcPrivateKey: btc.privateKey,
    solAddress: base58.encode(solPublic),
    solPrivateKey,
  };
}

/** Public Bitcoin and Solana addresses. Does not return private keys. */
export function chainAddresses(mnemonic: string): { btcAddress: string; solAddress: string } {
  const keys = deriveChainKeys(mnemonic);
  const out = {
    btcAddress: keys.btcAddress,
    solAddress: keys.solAddress,
  };
  wipe(keys.btcPrivateKey);
  wipe(keys.solPrivateKey);
  return out;
}
