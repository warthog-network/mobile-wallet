/**
 * Ledger Bitcoin app. The phone stores the address and the account xpub.
 * The Nano keeps the key and shows each payment before it signs.
 */
import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import { NETWORK, p2wpkh } from '@scure/btc-signer';
import { ethers } from 'ethers';
import { openLedgerIo } from './transport';
import { exchangeApdu, exchangeApduResult, LedgerError, statusMessage, type LedgerIo } from './protocol';
import {
  BTC_ACCOUNT_PATH,
  BitcoinClient,
  bitcoinAddressCommand,
  bitcoinContinueCommand,
  bitcoinExtendedKeyCommand,
  bitcoinFingerprintCommand,
  bitcoinSignCommand,
  merkleizedMap,
  nativeSegwitPolicy,
  parsePsbtMaps,
  parseYieldedSignature,
  type BitcoinPartialSignature,
} from './bitcoinProtocol';

async function withDevice<T>(run: (io: LedgerIo) => Promise<T>): Promise<T> {
  const io = await openLedgerIo();
  try {
    return await run(io);
  } finally {
    await io.close();
  }
}

function base58Check(payload: Uint8Array): string {
  const first = ethers.getBytes(ethers.sha256(payload));
  const checksum = ethers.getBytes(ethers.sha256(first)).subarray(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(checksum, payload.length);
  return base58.encode(full);
}

function readXpub(data: Uint8Array): string {
  const text = new TextDecoder().decode(data).replace(/\0/g, '').trim();
  if (/^xpub[1-9A-HJ-NP-Za-km-z]+$/.test(text)) return text;
  if (
    data.length >= 78
    && data[0] === 0x04
    && data[1] === 0x88
    && data[2] === 0xb2
    && data[3] === 0x1e
  ) {
    return base58Check(data.subarray(0, 78));
  }
  throw new LedgerError('Ledger returned a Bitcoin key this wallet cannot use');
}

/** Address 0 of an account xpub. Checked against the address the Nano displayed. */
export function bitcoinAddressFromXpub(xpub: string): { address: string; publicKey: Uint8Array } {
  let child: HDKey;
  try {
    child = HDKey.fromExtendedKey(xpub).derive("m/0/0");
  } catch {
    throw new LedgerError('Ledger returned a Bitcoin key this wallet cannot use');
  }
  if (!child.publicKey || child.publicKey.length !== 33) {
    throw new LedgerError('Ledger returned a Bitcoin key this wallet cannot use');
  }
  const payment = p2wpkh(child.publicKey, NETWORK);
  if (!payment.address || !payment.address.startsWith('bc1q')) {
    throw new LedgerError('Ledger returned a Bitcoin address this wallet cannot use');
  }
  return { address: payment.address, publicKey: child.publicKey };
}

async function runBitcoin(
  io: LedgerIo,
  first: Uint8Array,
  client?: BitcoinClient,
): Promise<{ data: Uint8Array; client: BitcoinClient | undefined }> {
  let command = first;
  for (let round = 0; round < 200; round += 1) {
    const result = await exchangeApduResult(io, command, 120_000);
    if (result.sw === 0x9000) return { data: result.data, client };
    if (result.sw !== 0xe000 || !client) throw new LedgerError(statusMessage(result.sw, 'bitcoin'));
    command = bitcoinContinueCommand(client.answer(result.data));
  }
  throw new LedgerError('The Bitcoin app did not finish');
}

async function readAccount(io: LedgerIo): Promise<{ fingerprint: string; accountXpub: string }> {
  const fingerprintData = await exchangeApdu(io, bitcoinFingerprintCommand(), 30_000, 'bitcoin');
  if (fingerprintData.length !== 4) throw new LedgerError('Ledger did not return a Bitcoin fingerprint');
  const accountData = await exchangeApdu(io, bitcoinExtendedKeyCommand(BTC_ACCOUNT_PATH), 30_000, 'bitcoin');
  return {
    fingerprint: ethers.hexlify(fingerprintData).slice(2),
    accountXpub: readXpub(accountData),
  };
}

/** Show the native segwit address and return the public account the Nano approved. */
export async function connectLedgerBtcAddress(): Promise<{
  address: string;
  publicKey: string;
  fingerprint: string;
  accountXpub: string;
}> {
  return withDevice(async (io) => {
    const account = await readAccount(io);
    const local = bitcoinAddressFromXpub(account.accountXpub);
    const policy = nativeSegwitPolicy(account.fingerprint, account.accountXpub);
    const client = new BitcoinClient();
    client.addPolicy(policy);
    const shown = await runBitcoin(io, bitcoinAddressCommand(policy, true), client);
    const address = new TextDecoder().decode(shown.data).trim();
    if (address !== local.address) {
      throw new LedgerError('Ledger returned a Bitcoin address this wallet cannot use');
    }
    return {
      address,
      publicKey: ethers.hexlify(local.publicKey).slice(2),
      fingerprint: account.fingerprint,
      accountXpub: account.accountXpub,
    };
  });
}

/**
 * Sign a PSBT v2 with the saved native-segwit account.
 * The Nano must still be this account. The phone checks each signature itself.
 */
export async function signPsbtOnLedger(
  psbt: Uint8Array,
  expected: { fingerprint: string; accountXpub: string },
): Promise<BitcoinPartialSignature[]> {
  return withDevice(async (io) => {
    const account = await readAccount(io);
    if (
      account.fingerprint.toLowerCase() !== expected.fingerprint.toLowerCase()
      || account.accountXpub !== expected.accountXpub
    ) {
      throw new LedgerError('This Nano account does not match the saved Bitcoin account.');
    }
    const policy = nativeSegwitPolicy(account.fingerprint, account.accountXpub);
    const maps = parsePsbtMaps(psbt);
    const client = new BitcoinClient();
    client.addPolicy(policy);
    client.addMap(maps.globalMap);
    for (const input of maps.inputMaps) client.addMap(input);
    for (const output of maps.outputMaps) client.addMap(output);
    client.addList(maps.inputMaps.map((item) => merkleizedMap(item)));
    client.addList(maps.outputMaps.map((item) => merkleizedMap(item)));
    await runBitcoin(
      io,
      bitcoinSignCommand(maps.globalMap, maps.inputMaps, maps.outputMaps, policy),
      client,
    );
    if (client.yielded.length === 0) throw new LedgerError('Ledger did not return a Bitcoin signature');
    return client.yielded.map((item) => parseYieldedSignature(item));
  });
}
