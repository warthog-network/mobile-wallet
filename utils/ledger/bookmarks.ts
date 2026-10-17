/**
 * Public Ledger names. A bookmark is a name, address, and path.
 * It is not a key file. The Nano still has to approve every spend.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LedgerPathType, LedgerSession } from './protocol';

const BOOKMARKS_KEY = 'warthogLedgerBookmarks';

export type LedgerBookmark = {
  name: string;
  address: string;
  publicKey: string;
  pathType: LedgerPathType;
  index: number;
};

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
      .map((row) => ({ ...row, name: row.name.trim(), pathType: asPath(row.pathType) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function writeAll(rows: LedgerBookmark[]): Promise<void> {
  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(rows));
}

/** Remember a Nano account under the name the user typed. */
export async function saveLedgerBookmark(bookmark: LedgerBookmark): Promise<void> {
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
  const without = existing.filter((row) => row.name !== name);
  without.push(next);
  without.sort((a, b) => a.name.localeCompare(b.name));
  await writeAll(without);
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
  };
}
