import { SECURE_STORE_KEYS } from '../constants';
import { cleanupPasskeyStorage } from './passkeyWallet';
import { storage } from './storage';

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
