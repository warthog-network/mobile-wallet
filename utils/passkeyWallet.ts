/**
 * Multi-auth wallet envelopes for mobile (WartBunker-compatible shape).
 *
 * Passkey on mobile = device biometrics (Face ID / fingerprint / device PIN)
 * via expo-local-authentication + AES key in SecureStore (mode: 'device').
 *
 * Envelope (JSON stored as warthogWallet_*):
 *  {
 *    v: 1,
 *    kind: 'warthog-wallet-v1',
 *    addressHint, require2fa,
 *    password: string | null,
 *    passkey: { credentialId, rpId, mode:'device', ciphertext, ... } | null
 *  }
 */
import * as ExpoCrypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';
import { Platform } from 'react-native';
import type { WalletData } from '../types';

const ENVELOPE_KIND = 'warthog-wallet-v1';
const ENVELOPE_V = 1;
const DEVICE_KEY_PREFIX = 'warthog-passkey-device-';

export type PasskeyBlock = {
  credentialId: string;
  rpId: string;
  mode: 'device' | 'prf';
  prfSalt?: string | null;
  iv?: string;
  ciphertext: string;
  transports?: string[];
  platformPreferred?: boolean;
  /** Device-key wrap: AES-GCM (v3) or legacy CryptoJS AES. */
  mobileCrypto?: 'aes-256-gcm' | 'cryptojs-aes';
};

export type WalletEnvelope = {
  v: number;
  kind: string;
  addressHint: string;
  require2fa: boolean;
  password: string | null;
  passkey: PasskeyBlock | null;
};

export type BlobInspect = {
  hasPassword: boolean;
  hasPasskey: boolean;
  passkeyMode: string | null;
  require2fa: boolean;
  addressHint: string;
  envelope: WalletEnvelope | null;
};

function randomHex(bytes: number): string {
  const arr = ExpoCrypto.getRandomBytes(bytes);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function shortAddressHint(address?: string): string {
  const a = String(address || '').replace(/^0x/i, '');
  if (a.length < 12) return a || '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function walletPayload(data: WalletData): WalletData {
  return {
    privateKey: data.privateKey,
    publicKey: data.publicKey,
    address: data.address,
    mnemonic: data.mnemonic,
    wordCount: data.wordCount,
    pathType: data.pathType,
  };
}

export function tryParseEnvelope(raw: string | null | undefined): WalletEnvelope | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s.startsWith('{')) return null;
  try {
    const obj = JSON.parse(s) as WalletEnvelope;
    if (obj && obj.kind === ENVELOPE_KIND && Number(obj.v) === ENVELOPE_V) return obj;
    return null;
  } catch {
    return null;
  }
}

export function serializeEnvelope(env: WalletEnvelope): string {
  return JSON.stringify(env);
}

export function getPasswordCipherFromBlob(raw: string | null | undefined): string | null {
  const env = tryParseEnvelope(raw);
  if (env) return env.password || null;
  return raw == null || raw === '' ? null : String(raw);
}

export function inspectWalletBlob(raw: string | null | undefined): BlobInspect {
  const env = tryParseEnvelope(raw);
  if (!env) {
    return {
      hasPassword: Boolean(raw),
      hasPasskey: false,
      passkeyMode: null,
      require2fa: false,
      addressHint: '',
      envelope: null,
    };
  }
  const hasPassword = Boolean(env.password);
  const hasPasskey = Boolean(env.passkey?.credentialId && env.passkey?.ciphertext);
  return {
    hasPassword,
    hasPasskey,
    passkeyMode: env.passkey?.mode || null,
    require2fa: Boolean(env.require2fa) && hasPassword && hasPasskey,
    addressHint: env.addressHint || '',
    envelope: env,
  };
}

export function authBadgeForBlob(raw: string | null | undefined): string {
  const info = inspectWalletBlob(raw);
  if (info.require2fa) return 'Password + passkey (2FA)';
  if (info.hasPasskey && info.hasPassword) return 'Passkey or password';
  if (info.hasPasskey) return 'Passkey';
  if (info.hasPassword) return 'Password';
  return 'Saved';
}

/**
 * True if the device can authenticate the user for wallet unlock.
 * Accepts enrolled biometrics OR a device lock (PIN / pattern / password).
 * Older builds only checked fingerprint/face hardware+enrollment and hid the whole UI.
 */
export async function isBiometricsAvailable(): Promise<boolean> {
  // expo-secure-store's web build is an empty module. Calling it throws
  // "setValueWithKeyAsync is not a function". Passkey stays on the phone app.
  if (Platform.OS === 'web') return false;
  try {
    // Prefer enrolled security level when available (Expo SDK 49+)
    if (typeof LocalAuthentication.getEnrolledLevelAsync === 'function') {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      // NONE = 0; SECRET = device credential; BIOMETRIC / BIOMETRIC_STRONG = biometrics
      if (level != null && level !== LocalAuthentication.SecurityLevel.NONE) {
        return true;
      }
    }

    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (enrolled) return true;

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    // Hardware present but nothing enrolled yet — still show the setup UI so the user
    // can enable biometrics in system settings and retry, instead of "no option".
    return hasHardware;
  } catch {
    // On some Android builds LocalAuthentication throws without USE_BIOMETRIC permission.
    // Still surface the UI; enable will show a clear error if auth truly fails.
    return true;
  }
}

/**
 * UI label for device-auth unlock. Always "passkey" — do not guess Face ID /
 * fingerprint / PIN; the OS prompt already names the method.
 */
export async function biometricsLabel(): Promise<string> {
  return 'passkey';
}

/** Sync alias for places that only need the constant string. */
export function passkeyLabel(): string {
  return 'passkey';
}

function assertPasskeyPlatform(during: 'save' | 'unlock' = 'save'): void {
  if (Platform.OS !== 'web') return;
  throw new Error(
    during === 'unlock'
      ? 'Passkey unlock is only available in the phone app. Use the wallet password.'
      : 'Passkey unlock is only available in the phone app. Set a password to save this wallet in the browser.',
  );
}

async function assertBiometrics(promptMessage: string): Promise<void> {
  assertPasskeyPlatform();
  // Always attempt system auth — PIN/pattern counts. Only hard-fail if nothing enrolled.
  try {
    if (typeof LocalAuthentication.getEnrolledLevelAsync === 'function') {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        throw new Error(
          'Set a screen lock in system settings first, then try passkey again',
        );
      }
    } else {
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!enrolled && !hasHardware) {
        throw new Error(
          'Passkey unlock is not available — enable a screen lock in system settings',
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && /screen lock|system settings|not available|passkey/i.test(e.message)) {
      throw e;
    }
    // Permission / API probe failed — still try authenticateAsync below
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: promptMessage || 'Unlock with passkey',
    cancelLabel: 'Cancel',
    // Allow device credential fallback when biometrics fail or are not enrolled
    disableDeviceFallback: false,
    fallbackLabel: 'Use screen lock',
  });
  if (!result.success) {
    throw new Error(
      result.error === 'user_cancel' || result.error === 'system_cancel'
        ? 'Biometric unlock cancelled'
        : result.error || 'Biometric unlock failed',
    );
  }
}

function deviceKeyStoreId(credentialId: string): string {
  // SecureStore keys must be alphanumeric + . - _
  const safe = credentialId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `${DEVICE_KEY_PREFIX}${safe}`;
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return globalThis.btoa(bin);
}

function unb64(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function encryptWithDeviceKey(plaintext: string, deviceKeyHex: string): Promise<{
  ciphertext: string;
  mobileCrypto: PasskeyBlock['mobileCrypto'];
}> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await subtle.importKey(
        'raw',
        hexToBytes(deviceKeyHex) as BufferSource,
        'AES-GCM',
        false,
        ['encrypt'],
      );
      const ct = new Uint8Array(
        await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
      );
      const ciphertext = JSON.stringify({
        v: 3,
        alg: 'aes-256-gcm',
        iv: b64(iv),
        ct: b64(ct),
      });
      // Verify before this is persisted. A wrap we cannot unwrap would strand
      // the wallet behind a passkey that decrypts nothing, and the device key
      // is the only copy — falling back to the CryptoJS wrap is recoverable.
      if ((await decryptWithDeviceKey(ciphertext, deviceKeyHex, 'aes-256-gcm')) !== plaintext) {
        throw new Error('AES-GCM round-trip mismatch');
      }
      return { ciphertext, mobileCrypto: 'aes-256-gcm' };
    } catch {
      /* fall through to the CryptoJS wrap below */
    }
  }
  return {
    ciphertext: CryptoJS.AES.encrypt(plaintext, deviceKeyHex).toString(),
    mobileCrypto: 'cryptojs-aes',
  };
}

async function decryptWithDeviceKey(
  ciphertext: string,
  deviceKeyHex: string,
  mobileCrypto?: PasskeyBlock['mobileCrypto'],
): Promise<string> {
  const inner = String(ciphertext || '').trim();
  const wantGcm =
    mobileCrypto === 'aes-256-gcm' ||
    (inner.startsWith('{') && /aes-256-gcm/.test(inner));
  if (wantGcm) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('decrypt failed');
    const envelope = JSON.parse(inner) as { iv: string; ct: string };
    const key = await subtle.importKey(
      'raw',
      hexToBytes(deviceKeyHex) as BufferSource,
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(envelope.iv) as BufferSource },
      key,
      unb64(envelope.ct) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  }
  const bytes = CryptoJS.AES.decrypt(inner, deviceKeyHex);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) throw new Error('decrypt failed');
  return decrypted;
}

/**
 * Encrypt wallet under a new biometric-gated device key.
 */
export async function encryptWithNewBiometrics(
  walletData: WalletData,
  { displayName }: { displayName?: string } = {},
): Promise<{ passkey: PasskeyBlock }> {
  assertPasskeyPlatform();
  if (!walletData?.privateKey || !walletData?.address) {
    throw new Error('Invalid wallet data for biometric encryption');
  }

  const credentialId = randomHex(16);
  const deviceKey = randomHex(32);
  const payload = walletPayload(walletData);
  const wrapped = await encryptWithDeviceKey(JSON.stringify(payload), deviceKey);

  await SecureStore.setItemAsync(deviceKeyStoreId(credentialId), deviceKey, {
    keychainService: 'warthog-wallet',
    requireAuthentication: true,
    authenticationPrompt: displayName
      ? `Confirm biometric unlock for “${displayName}”`
      : 'Confirm biometric unlock for this wallet',
  });

  return {
    passkey: {
      credentialId,
      rpId: 'mobile',
      mode: 'device',
      ciphertext: wrapped.ciphertext,
      transports: ['internal'],
      platformPreferred: true,
      mobileCrypto: wrapped.mobileCrypto,
    },
  };
}

export async function decryptWithBiometrics(
  passkeyBlock: PasskeyBlock,
): Promise<WalletData> {
  assertPasskeyPlatform('unlock');
  if (!passkeyBlock?.credentialId || !passkeyBlock?.ciphertext) {
    throw new Error('This wallet has no biometric unlock');
  }

  let deviceKey: string | null = null;
  try {
    deviceKey = await SecureStore.getItemAsync(
      deviceKeyStoreId(passkeyBlock.credentialId),
      {
        keychainService: 'warthog-wallet',
        requireAuthentication: true,
        authenticationPrompt: 'Unlock Warthog wallet',
      },
    );
  } catch {
    // Legacy keys stored without Keystore user-auth. Do not re-bind here —
    // setItemAsync(requireAuthentication) after the prompt can stall ~60s.
    try {
      deviceKey = await SecureStore.getItemAsync(
        deviceKeyStoreId(passkeyBlock.credentialId),
        { keychainService: 'warthog-wallet' },
      );
    } catch {
      deviceKey = null;
    }
  }
  if (!deviceKey) {
    throw new Error(
      'Device key missing (app data cleared or different device). Unlock with password or seed, then re-enable biometrics.',
    );
  }

  try {
    const decrypted = await decryptWithDeviceKey(
      passkeyBlock.ciphertext,
      deviceKey,
      passkeyBlock.mobileCrypto,
    );
    const data = JSON.parse(decrypted) as WalletData;
    if (!data?.privateKey || !data?.address) {
      throw new Error('Decrypted wallet data is invalid');
    }
    return data;
  } catch {
    throw new Error(
      'Biometric unlock failed — wrong device key or corrupted wallet data',
    );
  }
}

export async function buildEnvelopeWithBiometrics(
  walletData: WalletData,
  {
    displayName,
    existingPasswordCipher = null,
    previousEnvelope = null,
    require2fa = false,
  }: {
    displayName?: string;
    existingPasswordCipher?: string | null;
    previousEnvelope?: WalletEnvelope | null;
    require2fa?: boolean;
  } = {},
): Promise<{ envelope: WalletEnvelope }> {
  const { passkey } = await encryptWithNewBiometrics(walletData, { displayName });
  const prev =
    previousEnvelope && previousEnvelope.kind === ENVELOPE_KIND
      ? previousEnvelope
      : null;

  if (prev?.passkey?.credentialId && prev.passkey.credentialId !== passkey.credentialId) {
    await cleanupDeviceKey(prev.passkey.credentialId);
  }

  const password =
    existingPasswordCipher != null
      ? existingPasswordCipher
      : prev?.password != null
        ? prev.password
        : null;

  const want2fa = Boolean(require2fa);
  if (want2fa && !password) {
    throw new Error(
      '2FA needs a password as well — set a password, then enable password + biometrics',
    );
  }

  return {
    envelope: {
      v: ENVELOPE_V,
      kind: ENVELOPE_KIND,
      addressHint: shortAddressHint(walletData.address),
      require2fa: want2fa && Boolean(password),
      password,
      passkey,
    },
  };
}

export function envelopeWithPassword(
  walletData: WalletData,
  passwordCipher: string,
  previous: WalletEnvelope | null = null,
  { require2fa }: { require2fa?: boolean } = {},
): WalletEnvelope {
  const base: WalletEnvelope =
    previous && previous.kind === ENVELOPE_KIND
      ? { ...previous }
      : {
          v: ENVELOPE_V,
          kind: ENVELOPE_KIND,
          addressHint: shortAddressHint(walletData?.address),
          require2fa: false,
          password: null,
          passkey: null,
        };
  base.addressHint =
    shortAddressHint(walletData?.address) || base.addressHint;
  base.password = passwordCipher;
  if (typeof require2fa === 'boolean') {
    base.require2fa =
      require2fa && Boolean(passwordCipher) && Boolean(base.passkey);
  } else if (base.require2fa && !passwordCipher) {
    base.require2fa = false;
  }
  return base;
}

export async function unlockEnvelopeWith2fa(
  envelope: WalletEnvelope,
  password: string,
  decryptPasswordFn: (
    cipher: string,
    password: string,
  ) => WalletData | Promise<WalletData>,
): Promise<WalletData> {
  if (!envelope?.password || !envelope?.passkey) {
    throw new Error('2FA unlock needs both password and biometrics on this wallet');
  }
  if (!password) throw new Error('Password is required for 2FA unlock');

  const fromBio = await decryptWithBiometrics(envelope.passkey);

  let fromPassword: WalletData;
  try {
    fromPassword = await decryptPasswordFn(envelope.password, password);
  } catch {
    throw new Error('Invalid password');
  }
  const a = String(fromPassword?.address || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  const b = String(fromBio?.address || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  if (!a || !b || a !== b) {
    throw new Error(
      'Password and biometrics unlocked different keys — re-enable unlock methods',
    );
  }

  return {
    ...fromPassword,
    ...fromBio,
    privateKey: fromBio.privateKey || fromPassword.privateKey,
    publicKey: fromBio.publicKey || fromPassword.publicKey,
    address: fromBio.address || fromPassword.address,
  };
}

async function cleanupDeviceKey(credentialId: string): Promise<void> {
  try {
    // Same keychain service as encryptWithNewBiometrics. A delete without it
    // removes a different store entry and leaves the device key behind.
    await SecureStore.deleteItemAsync(deviceKeyStoreId(credentialId), {
      keychainService: 'warthog-wallet',
    });
  } catch {
    /* ignore */
  }
}

export async function cleanupPasskeyStorage(
  raw: string | null | undefined,
): Promise<void> {
  const env = tryParseEnvelope(raw);
  if (env?.passkey?.credentialId) {
    await cleanupDeviceKey(env.passkey.credentialId);
  }
}
