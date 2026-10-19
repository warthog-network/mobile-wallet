/**
 * Public Ledger names. A bookmark is a name, address, and path.
 * It is not a key file. The Nano still has to approve every spend.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address, NETWORK } from '@scure/btc-signer';
import { base58 } from '@scure/base';
import { ethers } from 'ethers';
import type { LedgerPathType, LedgerSession } from './protocol';

const BOOKMARKS_KEY = 'warthogLedgerBookmarks';

export type LedgerBookmark = {
  name: string;
  address: string;
  publicKey: string;
  pathType: LedgerPathType;
  index: number;
  ethAddress?: string;
  btcAddress?: string;
  btcPublicKey?: string;
  btcFingerprint?: string;
  btcAccountXpub?: string;
  solAddress?: string;
  solPublicKey?: string;
};

function cleanEth(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return ethers.getAddress(value.trim());
  } catch {
    return undefined;
  }
}

function cleanHex(value: unknown, bytes: number): string | undefined {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]+$/.test(value) || value.length !== bytes * 2) return undefined;
  return value.toLowerCase();
}

function cleanBtc(row: {
  btcAddress?: unknown;
  btcPublicKey?: unknown;
  btcFingerprint?: unknown;
  btcAccountXpub?: unknown;
}): Pick<LedgerBookmark, 'btcAddress' | 'btcPublicKey' | 'btcFingerprint' | 'btcAccountXpub'> | undefined {
  if (typeof row.btcAddress !== 'string' || typeof row.btcAccountXpub !== 'string') return undefined;
  if (!row.btcAccountXpub.startsWith('xpub')) return undefined;
  const publicKey = cleanHex(row.btcPublicKey, 33);
  const fingerprint = cleanHex(row.btcFingerprint, 4);
  if (!publicKey || !fingerprint) return undefined;
  try {
    Address(NETWORK).decode(row.btcAddress.trim());
  } catch {
    return undefined;
  }
  if (!row.btcAddress.trim().startsWith('bc1q')) return undefined;
  return {
    btcAddress: row.btcAddress.trim(),
    btcPublicKey: publicKey,
    btcFingerprint: fingerprint,
    btcAccountXpub: row.btcAccountXpub.trim(),
  };
}

function cleanSol(row: { solAddress?: unknown; solPublicKey?: unknown }): Pick<LedgerBookmark, 'solAddress' | 'solPublicKey'> | undefined {
  const publicKey = cleanHex(row.solPublicKey, 32);
  if (!publicKey || typeof row.solAddress !== 'string') return undefined;
  try {
    const raw = base58.decode(row.solAddress.trim());
    if (raw.length !== 32 || ethers.hexlify(raw).slice(2) !== publicKey) return undefined;
  } catch {
    return undefined;
  }
  return { solAddress: row.solAddress.trim(), solPublicKey: publicKey };
}

function isPath(value: unknown): value is LedgerPathType {
  return value === 'hardened' || value === 'normal' || value === 'non-hardened';
}

function asPath(value: LedgerPathType | 'non-hardened'): LedgerPathType {
  return value === 'non-hardened' ? 'normal' : value;
}

function isBookmark(value: unknown): value is LedgerBookmark {
  if (!value || typeof value !== 'object') return false;
  const row = value as LedgerBookmark;
  return (
    typeof row.name === 'string' &&
    row.name.trim().length > 0 &&
    typeof row.address === 'string' &&
    row.address.length === 48 &&
    typeof row.publicKey === 'string' &&
    row.publicKey.length === 130 &&
    isPath(row.pathType) &&
    typeof row.index === 'number' &&
    row.index >= 0
  );
}

export async function listLedgerBookmarks(): Promise<LedgerBookmark[]> {
  try {
    const raw = await AsyncStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isBookmark)
      .map((row) => {
        const ethAddress = cleanEth((row as { ethAddress?: unknown }).ethAddress);
        const btc = cleanBtc(row);
        const sol = cleanSol(row);
        const next: LedgerBookmark = {
          name: row.name.trim(),
          address: row.address,
          publicKey: row.publicKey,
          pathType: asPath(row.pathType),
          index: row.index,
        };
        if (ethAddress) next.ethAddress = ethAddress;
        if (btc) Object.assign(next, btc);
        if (sol) Object.assign(next, sol);
        return next;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function writeAll(rows: LedgerBookmark[]): Promise<void> {
  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(rows));
}

/** Remember a Nano account under the name the user typed. */
export async function saveLedgerBookmark(bookmark: LedgerBookmark): Promise<LedgerBookmark> {
  const name = bookmark.name.trim();
  if (!name) throw new Error('Wallet name is required');
  const next: LedgerBookmark = {
    name,
    address: bookmark.address,
    publicKey: bookmark.publicKey,
    pathType: bookmark.pathType,
    index: bookmark.index >>> 0,
  };
  if (!isBookmark(next)) throw new Error('Ledger bookmark is incomplete');
  const existing = await listLedgerBookmarks();
  const sameName = existing.find((row) => row.name === name);
  if (sameName && sameName.address.toLowerCase() !== next.address.toLowerCase()) {
    throw new Error('That name is already saved for a different Ledger account.');
  }
  const ethAddress = cleanEth(bookmark.ethAddress) ?? sameName?.ethAddress;
  if (ethAddress) next.ethAddress = ethAddress;
  const btc = cleanBtc(bookmark) ?? (sameName ? cleanBtc(sameName) : undefined);
  const sol = cleanSol(bookmark) ?? (sameName ? cleanSol(sameName) : undefined);
  if (btc) Object.assign(next, btc);
  if (sol) Object.assign(next, sol);
  const without = existing.filter((row) => row.name !== name);
  without.push(next);
  without.sort((a, b) => a.name.localeCompare(b.name));
  await writeAll(without);
  return next;
}

/** Save the Bitcoin account the Bitcoin app just approved for this name. */
export async function setLedgerBookmarkBtc(
  name: string,
  account: { address: string; publicKey: string; fingerprint: string; accountXpub: string },
): Promise<void> {
  const target = name.trim();
  const btc = cleanBtc({
    btcAddress: account.address,
    btcPublicKey: account.publicKey,
    btcFingerprint: account.fingerprint,
    btcAccountXpub: account.accountXpub,
  });
  if (!btc) throw new Error('Ledger returned a Bitcoin address this wallet cannot use');
  const existing = await listLedgerBookmarks();
  const current = existing.find((row) => row.name === target);
  if (!current) throw new Error('Save the Ledger account before adding Bitcoin.');
  await writeAll(existing.map((row) => (row.name === target ? { ...row, ...btc } : row)));
}

/** Save the Solana address the Solana app just approved for this name. */
export async function setLedgerBookmarkSol(
  name: string,
  account: { address: string; publicKey: string },
): Promise<void> {
  const target = name.trim();
  const sol = cleanSol({ solAddress: account.address, solPublicKey: account.publicKey });
  if (!sol) throw new Error('Ledger returned a Solana address this wallet cannot use');
  const existing = await listLedgerBookmarks();
  const current = existing.find((row) => row.name === target);
  if (!current) throw new Error('Save the Ledger account before adding Solana.');
  await writeAll(existing.map((row) => (row.name === target ? { ...row, ...sol } : row)));
}

/** Save the Ethereum address the Ethereum app just approved for this name. */
export async function setLedgerBookmarkEth(name: string, ethAddress: string): Promise<void> {
  const target = name.trim();
  const checksum = ethers.getAddress(ethAddress);
  const existing = await listLedgerBookmarks();
  const current = existing.find((row) => row.name === target);
  if (!current) throw new Error('Save the Ledger account before adding Ethereum.');
  await writeAll(existing.map((row) => (
    row.name === target ? { ...row, ethAddress: checksum } : row
  )));
}

/** Change the login name for one Nano account. The address stays the same. */
export async function renameLedgerBookmark(fromName: string, toName: string): Promise<void> {
  const from = fromName.trim();
  const to = toName.trim();
  if (!from || !to || from === to) return;
  const existing = await listLedgerBookmarks();
  const current = existing.find((row) => row.name === from);
  if (!current) return;
  const clash = existing.find((row) => row.name === to);
  if (clash && clash.address.toLowerCase() !== current.address.toLowerCase()) {
    throw new Error('That name is already saved for a different Ledger account.');
  }
  const without = existing.filter((row) => row.name !== from && row.name !== to);
  without.push({ ...current, name: to });
  without.sort((a, b) => a.name.localeCompare(b.name));
  await writeAll(without);
}

export async function deleteLedgerBookmark(name: string): Promise<void> {
  const target = name.trim();
  const existing = await listLedgerBookmarks();
  await writeAll(existing.filter((row) => row.name !== target));
}

export function sessionFromBookmark(bookmark: LedgerBookmark): LedgerSession {
  return {
    name: bookmark.name,
    address: bookmark.address,
    publicKey: bookmark.publicKey,
    pathType: bookmark.pathType,
    index: bookmark.index,
    ethAddress: bookmark.ethAddress,
    btcAddress: bookmark.btcAddress,
    btcPublicKey: bookmark.btcPublicKey,
    btcFingerprint: bookmark.btcFingerprint,
    btcAccountXpub: bookmark.btcAccountXpub,
    solAddress: bookmark.solAddress,
    solPublicKey: bookmark.solPublicKey,
  };
}
