import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';

/** Expo SecureStore allows only A–Z, 0–9, ".", "-", and "_". */
const SAFE_STORE_KEY = /^[A-Za-z0-9._-]+$/;

/**
 * Keep already-valid keys unchanged so wallets saved by older builds still open.
 * Names with spaces or other punctuation (a file named "Selected file", "My Wallet")
 * are stored under a stable hash of the original key.
 */
export function toSecureStoreKey(key: string): string {
  const raw = String(key ?? '');
  if (SAFE_STORE_KEY.test(raw)) return raw;
  const digest = CryptoJS.SHA256(raw).toString(CryptoJS.enc.Hex).slice(0, 32);
  const stem = raw.replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 24);
  return `${stem || 'key'}.${digest}`;
}

const ENCRYPTION_OPTIONS = {
  keychainService: 'warthog-wallet',
  sharedPreferencesName: 'warthog-wallet',
  encrypt: true,
  requireAuthentication: false,
  accessGroup: undefined,
};

export const storage = {
  async setItemAsync(key: string, value: string): Promise<void> {
    const storeKey = toSecureStoreKey(key);
    if (Platform.OS === 'web') {
      localStorage.setItem(storeKey, value);
    } else {
      await SecureStore.setItemAsync(storeKey, value, ENCRYPTION_OPTIONS);
    }
  },

  async getItemAsync(key: string): Promise<string | null> {
    const storeKey = toSecureStoreKey(key);
    if (Platform.OS === 'web') {
      return localStorage.getItem(storeKey);
    } else {
      return await SecureStore.getItemAsync(storeKey, ENCRYPTION_OPTIONS);
    }
  },

  async deleteItemAsync(key: string): Promise<void> {
    const storeKey = toSecureStoreKey(key);
    if (Platform.OS === 'web') {
      localStorage.removeItem(storeKey);
    } else {
      await SecureStore.deleteItemAsync(storeKey, ENCRYPTION_OPTIONS);
    }
  }
};
