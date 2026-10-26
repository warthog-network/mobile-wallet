import { SECURE_STORE_KEYS } from '../constants';
import { cleanupPasskeyStorage } from './passkeyWallet';
import { storage, toSecureStoreKey } from './storage';

function namesFromStored(raw: string | null): string[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Saved wallet list is unreadable');
  }
  return parsed.filter((name): name is string => typeof name === 'string');
}

/**
 * Remove one saved software wallet and its passkey device key.
 * Returns the name list that was written back.
 */
export async function forgetSavedWallet(name: string): Promise<string[]> {
  const rawName = String(name ?? '');
  const target = rawName.trim();
  if (!target) throw new Error('No wallet selected');

  const keys = new Set<string>([
    SECURE_STORE_KEYS.wallet(target),
    SECURE_STORE_KEYS.wallet(rawName),
  ]);
  for (const key of keys) {
    try {
      const blob = await storage.getItemAsync(key);
      await cleanupPasskeyStorage(blob);
    } catch {
      /* The name list still has to drop this wallet. */
    }
    await storage.deleteItemAsync(key);
  }

  const stored = await storage.getItemAsync(SECURE_STORE_KEYS.walletNames);
  const updated = namesFromStored(stored).filter((entry) => entry.trim() !== target);
  await storage.setItemAsync(SECURE_STORE_KEYS.walletNames, JSON.stringify(updated));
  return updated;
}

/** Move one saved software wallet to a new name. The encrypted blob is unchanged. */
export async function renameSavedWallet(fromName: string, toName: string): Promise<string[]> {
  const from = String(fromName ?? '').trim();
  const to = String(toName ?? '').trim();
  if (!from || !to) throw new Error('Enter a name');
  const stored = await storage.getItemAsync(SECURE_STORE_KEYS.walletNames);
  const names = namesFromStored(stored);
  if (from === to) return names;
  if (!names.includes(from)) throw new Error('This wallet is not saved on the phone');
  if (names.some((entry) => entry !== from && entry === to)) throw new Error('That name is already used');
  const blob = await storage.getItemAsync(SECURE_STORE_KEYS.wallet(from));
  if (!blob) throw new Error('Saved wallet data was not found');
  await storage.setItemAsync(SECURE_STORE_KEYS.wallet(to), blob);
  const fromKey = toSecureStoreKey(SECURE_STORE_KEYS.wallet(from));
  const toKey = toSecureStoreKey(SECURE_STORE_KEYS.wallet(to));
  if (fromKey !== toKey) await storage.deleteItemAsync(SECURE_STORE_KEYS.wallet(from));
  const updated = names.map((entry) => (entry === from ? to : entry));
  await storage.setItemAsync(SECURE_STORE_KEYS.walletNames, JSON.stringify(updated));
  return updated;
}
