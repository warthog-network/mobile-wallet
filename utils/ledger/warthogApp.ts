/**
 * Connect and sign with the Warthog app on a Nano S+.
 * The phone stores the address only. Each signature happens on the device.
 */
import { ethers } from 'ethers';
import type { TransactionJson } from 'warthog-ts';
import { openLedgerIo } from './transport';
import {
  exchangeApdu,
  LedgerError,
  ledgerWartSubmitJson,
  publicKeyCommand,
  signCommands,
  wartAddressFromUncompressed,
  wartTransferBytes,
  type LedgerIo,
  type LedgerPathType,
  type LedgerSession,
} from './protocol';

export { LedgerError, ledgerWartSubmitJson };
export type { LedgerPathType, LedgerSession };

async function withDevice<T>(run: (io: LedgerIo) => Promise<T>): Promise<T> {
  const io = await openLedgerIo();
  try {
    return await run(io);
  } finally {
    await io.close();
  }
}

export async function connectLedgerAccount(
  pathType: LedgerPathType,
  index = 0,
): Promise<Omit<LedgerSession, 'name'>> {
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return withDevice(async (io) => {
    const data = await exchangeApdu(io, publicKeyCommand(pathType, safeIndex), 120_000);
    if (data.length < 66 || data[0] !== 65) {
      throw new LedgerError('Ledger did not return a public key');
    }
    const publicKey = data.subarray(1, 66);
    return {
      address: wartAddressFromUncompressed(publicKey),
      publicKey: ethers.hexlify(publicKey).slice(2),
      pathType,
      index: safeIndex,
    };
  });
}

export async function signWartTransferOnLedger(
  session: Pick<LedgerSession, 'pathType' | 'index'>,
  fields: {
    pinHash: string;
    pinHeight: number;
    nonceId: number;
    feeE8: bigint;
    toAddress: string;
    amountE8: bigint;
  },
): Promise<TransactionJson> {
  const raw = wartTransferBytes(fields);
  const [first, second] = signCommands(session.pathType, session.index, raw);
  const signature = await withDevice(async (io) => {
    await exchangeApdu(io, first, 20_000);
    return exchangeApdu(io, second, 120_000);
  });
  if (signature.length !== 65) {
    throw new LedgerError('Ledger signature was not 65 bytes');
  }
  return {
    type: 'wartTransfer',
    pinHeight: fields.pinHeight,
    nonceId: fields.nonceId,
    feeE8: fields.feeE8,
    toAddr: fields.toAddress,
    wartE8: fields.amountE8,
    signature65: ethers.hexlify(signature).slice(2),
  };
}
