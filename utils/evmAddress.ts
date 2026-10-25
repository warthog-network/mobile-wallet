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

/** Ethereum address of a raw secp256k1 key. A private-key file has no phrase, so this is its USDT address. */
export function ethAddressFromPrivateKey(privateKey: string): string {
  const hex = privateKey.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return '';
  try {
    return new ethers.Wallet(`0x${hex}`).address;
  } catch {
    return '';
  }
}
