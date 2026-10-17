import type { WalletData } from '../types';
import { deriveEthAddress } from './evmAddress';

let session: WalletData | null = null;

export function setSessionKeys(data: WalletData): void {
  session = {
    ...data,
    privateKey: String(data.privateKey || '').replace(/^0x/i, ''),
  };
}

export function clearSessionKeys(): void {
  if (session) {
    session.privateKey = '';
    session.mnemonic = undefined;
  }
  session = null;
}

export function hasSessionKeys(): boolean {
  return Boolean(session?.privateKey);
}

export function getSessionPrivateKey(): string {
  const pk = session?.privateKey;
  if (!pk) throw new Error('Wallet is locked — unlock to sign');
  return pk;
}

export function getSessionMnemonic(): string | undefined {
  return session?.mnemonic;
}

export function getSessionWallet(): WalletData | null {
  return session;
}

/** Full key material for persist / export. Throws if locked. */
export function requireSessionWallet(): WalletData {
  if (!session?.privateKey) {
    throw new Error('Wallet is locked — unlock to sign');
  }
  return session;
}

/** Public fields safe to keep in React state. */
export function publicWallet(data: WalletData): WalletData {
  let ethAddress = data.ethAddress;
  if (!ethAddress && data.mnemonic) {
    try {
      ethAddress = deriveEthAddress(data.mnemonic);
    } catch {
      ethAddress = undefined;
    }
  }
  return {
    ...data,
    ethAddress,
    privateKey: '',
    mnemonic: undefined,
  };
}
