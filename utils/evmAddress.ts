import { ethers } from 'ethers';
import { ETH_DERIVATION_PATH } from '../constants';

export function normalizeEthPhrase(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Ethereum account for a BIP39 phrase at m/44'/60'/0'/0/0. No extra passphrase. */
export function deriveEthWallet(mnemonic: string): ethers.HDNodeWallet {
  return ethers.HDNodeWallet.fromPhrase(normalizeEthPhrase(mnemonic), undefined, ETH_DERIVATION_PATH);
}

/** Ethereum address for a BIP39 phrase. Does not return the private key. */
export function deriveEthAddress(mnemonic: string): string {
  return deriveEthWallet(mnemonic).address;
}

export function isEthAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}
