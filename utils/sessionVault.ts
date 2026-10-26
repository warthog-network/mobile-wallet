import type { AnyTransactionContext, LegacyTransactionJson, TransactionJson } from 'warthog-ts';
import type { WalletData } from '../types';
import type { LedgerSession } from './ledger/protocol';
import { publicChains, signBitcoinPhrase, signEthereumPhrase, signSolanaPhrase, type ChainPublic } from './phraseSign';
import type { WarthogSignOp, WarthogSignRequest } from './warthogSign';

export type { ChainPublic, WarthogSignOp, WarthogSignRequest };

/**
 * The only holder of the recovery phrase and the active Warthog key.
 * Screens ask for a public address or a signature. The phrase leaves only
 * through exportWallet, which reveal and encrypted backup ask for.
 */
let secret: WalletData | null = null;
let ledger: LedgerSession | null = null;
let accountIndex = 0;

function normalizeKey(raw: string): string {
  return String(raw || '').trim().replace(/^0x/i, '');
}

export function getSessionAccountIndex(): number {
  return accountIndex;
}

export function setSessionAccountIndex(index: number): void {
  accountIndex = Number.isSafeInteger(index) && index >= 0 && index < 0x80000000 ? index : 0;
}

/**
 * Remember which account is selected. The phrase argument used to be stored here.
 * It is ignored so a caller cannot read the recovery phrase back out.
 */
export function setChainSession(mnemonic: string | null | undefined, index = 0): void {
  setSessionAccountIndex(mnemonic?.trim() ? index : 0);
}

export function setSessionKeys(data: WalletData): void {
  const privateKey = normalizeKey(data.privateKey);
  if (privateKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKey)) {
    throw new Error('Invalid private key');
  }
  ledger = null;
  accountIndex = 0;
  const phrase = String(data.mnemonic || '').trim();
  secret = {
    ...data,
    privateKey,
    mnemonic: phrase || undefined,
  };
}

export function clearSessionKeys(): void {
  if (secret) {
    secret.privateKey = '';
    secret.mnemonic = undefined;
  }
  secret = null;
  accountIndex = 0;
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
  return Boolean(secret?.privateKey);
}

/** Always empty. Chain code asks the signer instead of reading the key. */
export function getSessionPrivateKey(): string {
  return '';
}

/** Always empty. Chain code asks the signer instead of reading the phrase. */
export function getSessionMnemonic(): string {
  return '';
}

export function signingStatus(): {
  unlocked: boolean;
  address: string | null;
  publicKey: string | null;
  hasMnemonic: boolean;
} {
  return {
    unlocked: Boolean(secret?.privateKey),
    address: secret?.address ?? null,
    publicKey: secret?.publicKey ?? null,
    hasMnemonic: Boolean(secret?.mnemonic),
  };
}

/** Public fields only. The phrase and the Warthog key stay in this module. */
export function getSessionWallet(): WalletData | null {
  if (!secret?.privateKey) return null;
  return publicWallet(secret);
}

/** Explicit user export only (show key, download, encrypted backup). */
export function exportWallet(): WalletData {
  if (!secret?.privateKey) {
    throw new Error('Wallet is locked — unlock to sign');
  }
  return { ...secret };
}

/** Full key material for persist / export. Throws if locked. */
export function requireSessionWallet(): WalletData {
  return exportWallet();
}

export function chainPublic(index = getSessionAccountIndex()): ChainPublic | null {
  if (!secret?.privateKey || !secret.mnemonic) return null;
  return publicChains(secret.mnemonic, index);
}

export function signEthereum(index: number, unsignedSerialized: string): string {
  if (!secret?.mnemonic) throw new Error('Wallet is locked');
  const signature = signEthereumPhrase(secret.mnemonic, index, unsignedSerialized);
  if (!signature) throw new Error('Could not sign the Ethereum transaction.');
  return signature;
}

export function signSolana(index: number, message: Uint8Array): Uint8Array {
  if (!secret?.mnemonic) throw new Error('Wallet is locked');
  if (message.length === 0) throw new Error('Bad Solana transaction.');
  const signature = signSolanaPhrase(secret.mnemonic, index, message);
  if (signature.length !== 64) throw new Error('Could not sign the Solana transaction.');
  return signature;
}

export function signBitcoin(index: number, psbt: Uint8Array): { hex: string; txid: string } {
  if (!secret?.mnemonic) throw new Error('Wallet is locked');
  if (psbt.length === 0) throw new Error('Bad Bitcoin transaction.');
  const signed = signBitcoinPhrase(secret.mnemonic, index, psbt);
  if (!signed.hex || !/^[0-9a-f]{64}$/i.test(signed.txid)) {
    throw new Error('Could not sign the Bitcoin transaction.');
  }
  return signed;
}

export function warthogContextFields(
  ctx: AnyTransactionContext,
  defiContext: abstract new (...args: never[]) => unknown,
): Pick<WarthogSignRequest, 'family' | 'pinHash' | 'pinHeight' | 'nonceId' | 'feeE8'> {
  return {
    family: ctx instanceof defiContext ? 'defi' : 'legacy',
    pinHash: ctx.chainPin.pinHash,
    pinHeight: ctx.chainPin.pinHeight,
    nonceId: ctx.nonceId.value,
    feeE8: ctx.fee.E8.toString(),
  };
}

/**
 * Sign a prepared Warthog transaction. The caller never receives an Account.
 * warthog-ts loads here, not when the module is imported, so address checks
 * can run without it.
 */
export async function signPreparedWarthog(
  ctx: AnyTransactionContext,
  op: WarthogSignOp,
  expectedAddress?: string,
): Promise<TransactionJson | LegacyTransactionJson> {
  if (!secret?.privateKey) throw new Error('Wallet is locked — unlock to sign');
  const [{ WarthogDeFiTransactionContext }, { signWarthogTx }] = await Promise.all([
    import('warthog-ts'),
    import('./warthogSign'),
  ]);
  return signWarthogTx(
    secret.privateKey,
    { ...warthogContextFields(ctx, WarthogDeFiTransactionContext), ...op },
    expectedAddress,
  );
}

/** Public fields safe to keep in React state. */
export function publicWallet(data: WalletData): WalletData {
  let ethAddress = data.ethAddress;
  let btcAddress = data.btcAddress;
  let solAddress = data.solAddress;
  if (data.mnemonic && (!ethAddress || !btcAddress || !solAddress)) {
    try {
      const pubs = publicChains(data.mnemonic, getSessionAccountIndex());
      ethAddress = ethAddress || pubs.ethAddress;
      btcAddress = btcAddress || pubs.btcAddress;
      solAddress = solAddress || pubs.solAddress;
    } catch {
      ethAddress = ethAddress || undefined;
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
