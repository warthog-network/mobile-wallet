/**
 * Ledger Ethereum app. The Warthog app cannot derive m/44'/60'/0'/0/0.
 * The phone asks the Ethereum app for that address, then for each signature.
 */
import { ethers } from 'ethers';
import { openLedgerIo } from './transport';
import {
  ethPublicKeyCommand,
  ethSignCommands,
  exchangeApdu,
  LedgerError,
  parseEthPublicKey,
  parseEthSignature,
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

/** Show m/44'/60'/0'/0/0 on the Nano and return the checksummed address. */
export async function connectLedgerEthAddress(): Promise<string> {
  return withDevice(async (io) => {
    const data = await exchangeApdu(io, ethPublicKeyCommand(), 120_000, 'ethereum');
    return parseEthPublicKey(data);
  });
}

/** Sign one unsigned EIP-1559 transaction. The Ethereum app must stay open. */
export async function signEthereumOnLedger(unsignedSerialized: string): Promise<ethers.Signature> {
  const commands = ethSignCommands(ethers.getBytes(unsignedSerialized));
  return withDevice(async (io) => {
    let data: Uint8Array | null = null;
    for (const command of commands) {
      data = await exchangeApdu(io, command, 120_000, 'ethereum');
    }
    if (!data) throw new LedgerError('Ledger did not return a signature');
    const parsed = parseEthSignature(data);
    return ethers.Signature.from(parsed);
  });
}
