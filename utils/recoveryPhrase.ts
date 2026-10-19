/**
 * Recovery phrase from a fresh password or passkey decrypt.
 * The open session address must match. In-memory session state is not a fallback.
 */
export function recoveryPhraseFromDecrypt(
  sessionAddress: string | null | undefined,
  decrypted: { address?: string; mnemonic?: string | null } | null | undefined,
): string {
  const sessionAddr = String(sessionAddress || '').replace(/^0x/i, '').toLowerCase();
  const got = String(decrypted?.address || '').replace(/^0x/i, '').toLowerCase();
  if (!sessionAddr || !got || sessionAddr !== got) {
    throw new Error('That unlock does not match this wallet.');
  }
  const phrase = String(decrypted?.mnemonic || '').trim().replace(/\s+/g, ' ');
  if (!phrase) {
    throw new Error('This wallet has no recovery phrase. It was saved from a private key.');
  }
  return phrase;
}
