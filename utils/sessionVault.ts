import type { WalletData } from '../types';
import { deriveEthAddress } from './evmAddress';
import type { LedgerSession } from './ledger/protocol';
import { chainAddresses } from './networks/derive';

let session: WalletData | null = null;
let ledger: LedgerSession | null = null;

export function setSessionKeys(data: WalletData): void {
  ledger = null;
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

export function setLedgerSession(next: LedgerSession): void {
  clearSessionKeys();
  ledger = next;
}

export function clearLedgerSession(): void {
  ledger = null;
}

export function getLedgerSession(): LedgerSession | null {
  return ledger;
}

export function isLedgerSession(): boolean {
  return ledger != null;
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
  let btcAddress = data.btcAddress;
  let solAddress = data.solAddress;
  if (data.mnemonic && (!ethAddress || !btcAddress || !solAddress)) {
    try {
      if (!ethAddress) ethAddress = deriveEthAddress(data.mnemonic);
    } catch {
      ethAddress = undefined;
    }
    try {
      const extra = chainAddresses(data.mnemonic);
      btcAddress = btcAddress || extra.btcAddress;
      solAddress = solAddress || extra.solAddress;
    } catch {
      btcAddress = btcAddress || undefined;
      solAddress = solAddress || undefined;
    }
  }
  return {
    ...data,
    ethAddress,
    btcAddress,
    solAddress,
    privateKey: '',
    mnemonic: undefined,
  };
}
