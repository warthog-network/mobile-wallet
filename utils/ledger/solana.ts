/**
 * Ledger Solana app. The phone stores the public key.
 * The Nano approves the address, then each message.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { openLedgerIo } from './transport';
import {
  exchangeApdu,
  LedgerError,
  parseSolPublicKey,
  solPublicKeyCommand,
  solSignCommands,
  type LedgerIo,
} from './protocol';

async function withDevice<T>(run: (io: LedgerIo) => Promise<T>): Promise<T> {
  const io = await openLedgerIo();
  try {
    return await run(io);
  } finally {
    await io.close();
  }
}

/** Show m/44'/501'/0'/0' and return the address the Solana app displayed. */
export async function connectLedgerSolAddress(): Promise<{ address: string; publicKey: string }> {
  return withDevice(async (io) => {
    const data = await exchangeApdu(io, solPublicKeyCommand(), 120_000, 'solana');
    const publicKey = parseSolPublicKey(data);
    return {
      address: base58.encode(publicKey),
      publicKey: Array.from(publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    };
  });
}

/** Sign one message. The signature is checked against the saved public key before it is returned. */
export async function signSolanaOnLedger(message: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  if (publicKey.length !== 32) throw new LedgerError('Ledger returned a Solana public key this wallet cannot use');
  const commands = solSignCommands(message);
  return withDevice(async (io) => {
    let data: Uint8Array<ArrayBufferLike> = new Uint8Array();
    for (const command of commands) {
      data = await exchangeApdu(io, command, 120_000, 'solana');
    }
    if (data.length !== 64 || !ed25519.verify(data, message, publicKey)) {
      throw new LedgerError('Ledger returned a Solana signature this wallet cannot use');
    }
    return data;
  });
}
