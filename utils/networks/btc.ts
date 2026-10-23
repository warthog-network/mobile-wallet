import { secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import { Address, NETWORK, OutScript, Transaction, p2wpkh } from '@scure/btc-signer';
import { ethers } from 'ethers';
import { BTC_ADDRESS_PATH } from '../ledger/bitcoinProtocol';
import { getLedgerSession, getSessionMnemonic } from '../sessionVault';
import { BTC_DECIMALS, DUST_SATS, MEMPOOL } from './chains';
import { deriveChainKeys, type ChainKeys } from './derive';
import { networkFetch } from './http';
import { formatUnits, parseUnits } from './units';

export type Utxo = { txid: string; vout: number; value: number };

type BuiltTx = { hex: string; txid: string; feeSats: bigint; outputIndex: number };

/** ASCII uppercase Hemi address without 0x. The vault reads this OP_RETURN. */
export function tunnelMemo(hemiAddress: string): Uint8Array {
  const body = hemiAddress.trim().slice(2).toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(body)) throw new Error('Hemi address must be 20 bytes.');
  return new TextEncoder().encode(body);
}

function scriptPush(data: Uint8Array): Uint8Array {
  if (data.length > 80) throw new Error('Memo is too long for a Bitcoin OP_RETURN.');
  if (data.length >= 76) {
    const out = new Uint8Array(3 + data.length);
    out[0] = 0x6a;
    out[1] = 0x4c;
    out[2] = data.length;
    out.set(data, 3);
    return out;
  }
  const out = new Uint8Array(2 + data.length);
  out[0] = 0x6a;
  out[1] = data.length;
  out.set(data, 2);
  return out;
}

function paymentScript(publicKey: Uint8Array): Uint8Array {
  const payment = p2wpkh(publicKey, NETWORK);
  if (!payment.script) throw new Error('Could not build the Bitcoin spend script.');
  return payment.script;
}

function guessVsize(inputs: number, outputs: number): bigint {
  return BigInt(11 + inputs * 68 + outputs * 43);
}

/** Worst-case native-segwit witness, so a Ledger fee is not short a byte. */
function placeholderVsize(tx: Transaction, publicKey: Uint8Array): number {
  const copy = tx.clone();
  const dummy = new Uint8Array(73);
  dummy[0] = 0x30;
  for (let i = 0; i < copy.inputsLength; i += 1) {
    copy.updateInput(i, { partialSig: [[publicKey, dummy]] }, true);
  }
  copy.finalize();
  return Math.ceil(copy.weight / 4);
}

export function assertBtcAddress(address: string): string {
  const text = address.trim();
  try {
    Address(NETWORK).decode(text);
  } catch {
    throw new Error('Enter a Bitcoin address.');
  }
  return text;
}

export function parseBtc(amount: string): bigint {
  return parseUnits(amount, BTC_DECIMALS, 'Bitcoin');
}

export function formatBtc(sats: bigint): string {
  return formatUnits(sats, BTC_DECIMALS);
}

/** Miner fee for a send. `withMemo` adds the tunnel OP_RETURN output. */
export function estimateSpend(utxos: Utxo[], amount: bigint, feeRate: number, withMemo = false): bigint {
  const outputs = withMemo ? 3 : 2;
  let sum = 0n;
  let count = 0;
  for (const utxo of utxos) {
    count += 1;
    sum += BigInt(utxo.value);
    const fee = BigInt(feeRate) * guessVsize(count, outputs);
    if (sum >= amount + fee + DUST_SATS) return fee;
  }
  return BigInt(feeRate) * guessVsize(Math.max(1, count), outputs);
}

export async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await networkFetch(`${MEMPOOL}/api/address/${address}/utxo`);
  if (!res.ok) throw new Error('Could not load Bitcoin coins.');
  const rows = (await res.json()) as Utxo[];
  return rows.sort((a, b) => b.value - a.value);
}

export async function fetchFeeRate(): Promise<number> {
  const res = await networkFetch(`${MEMPOOL}/api/v1/fees/recommended`);
  if (!res.ok) return 5;
  const body = (await res.json()) as { halfHourFee?: number };
  return Math.max(1, body.halfHourFee ?? 5);
}

/** True when `address` receives at least `minSats` in a transaction at or after `sinceMs`. */
export async function findBtcCredit(address: string, sinceMs: number, minSats: bigint): Promise<boolean> {
  if (minSats <= 0n) return false;
  const res = await networkFetch(`${MEMPOOL}/api/address/${address}/txs`);
  if (!res.ok) return false;
  const txs = (await res.json()) as {
    status?: { confirmed?: boolean; block_time?: number };
    vout?: { scriptpubkey_address?: string; value?: number }[];
  }[];
  for (const tx of txs) {
    const when = tx.status?.block_time ? tx.status.block_time * 1000 : Date.now();
    if (when + 120_000 < sinceMs) continue;
    const got = (tx.vout ?? [])
      .filter((out) => out.scriptpubkey_address === address)
      .reduce((sum, out) => sum + BigInt(out.value ?? 0), 0n);
    if (got >= minSats) return true;
  }
  return false;
}

export async function fetchBtcBalance(address: string): Promise<bigint> {
  const res = await networkFetch(`${MEMPOOL}/api/address/${address}`);
  if (!res.ok) throw new Error('Could not load the Bitcoin balance.');
  const body = (await res.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const confirmed = BigInt(body.chain_stats.funded_txo_sum - body.chain_stats.spent_txo_sum);
  const pending = BigInt(body.mempool_stats.funded_txo_sum - body.mempool_stats.spent_txo_sum);
  return confirmed + pending;
}

async function broadcastTx(rawHex: string): Promise<string> {
  const res = await networkFetch(`${MEMPOOL}/api/tx`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: rawHex,
  });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(text || 'Bitcoin rejected the transaction.');
  return text;
}

/**
 * Signed native-segwit send. Optional `memo` is the Hemi tunnel OP_RETURN.
 * The payment is output 0, which is the index confirmDeposit expects.
 */
export function buildSignedTx(input: {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  utxos: Utxo[];
  payTo: { address: string; amount: bigint };
  changeAddress: string;
  feeRate: number;
  memo?: Uint8Array;
  /** When set, the OP_RETURN follows change. Otherwise the memo is the middle output. */
  memoAfterChange?: boolean;
}): BuiltTx {
  if (input.payTo.amount < DUST_SATS) throw new Error('That Bitcoin amount is below the dust limit.');
  const script = paymentScript(input.publicKey);
  const extras = input.memo ? [{ script: scriptPush(input.memo), amount: 0n }] : [];
  let fee = BigInt(input.feeRate) * guessVsize(2, extras.length + 2);
  let last: BuiltTx | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const selected: Utxo[] = [];
    let sum = 0n;
    for (const utxo of input.utxos) {
      selected.push(utxo);
      sum += BigInt(utxo.value);
      const feeIfChange = BigInt(input.feeRate) * guessVsize(selected.length, extras.length + 2);
      const feeIfDrop = BigInt(input.feeRate) * guessVsize(selected.length, extras.length + 1);
      if (sum >= input.payTo.amount + feeIfChange + DUST_SATS) {
        fee = feeIfChange;
        break;
      }
      if (sum >= input.payTo.amount + feeIfDrop) {
        fee = feeIfDrop;
        break;
      }
    }
    if (sum < input.payTo.amount + fee) {
      throw new Error('Not enough Bitcoin for that amount and the network fee.');
    }
    let change = sum - input.payTo.amount - fee;
    const outputs = extras.length + (change >= DUST_SATS ? 2 : 1);
    fee = BigInt(input.feeRate) * guessVsize(selected.length, outputs);
    if (sum < input.payTo.amount + fee) {
      throw new Error('Not enough Bitcoin for that amount and the network fee.');
    }
    change = sum - input.payTo.amount - fee;
    const keepChange = change >= DUST_SATS;
    if (!keepChange) {
      fee += change;
      change = 0n;
    }

    const tx = new Transaction({ allowUnknownOutputs: extras.length > 0 });
    for (const utxo of selected) {
      tx.addInput({
        txid: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script, amount: BigInt(utxo.value) },
      });
    }
    tx.addOutputAddress(input.payTo.address, input.payTo.amount, NETWORK);
    if (input.memoAfterChange && keepChange) tx.addOutputAddress(input.changeAddress, change, NETWORK);
    for (const extra of extras) tx.addOutput({ script: extra.script, amount: extra.amount });
    if (!input.memoAfterChange && keepChange) tx.addOutputAddress(input.changeAddress, change, NETWORK);
    tx.sign(input.privateKey);
    tx.finalize();
    const vsize = Math.ceil(tx.weight / 4);
    const exact = BigInt(input.feeRate) * BigInt(vsize);
    last = { hex: tx.hex, txid: tx.id, feeSats: fee, outputIndex: 0 };
    if (exact === fee || attempt === 3) return last;
    fee = exact;
  }
  if (!last) throw new Error('Could not build the Bitcoin transaction.');
  return last;
}

type UnsignedSpend = { tx: Transaction; feeSats: bigint; changeIndex: number | null };

/**
 * Same coin selection as a signed send, without a signature.
 * The fee uses a 73-byte signature so the Nano is not asked to underpay.
 */
function buildUnsignedSpend(input: {
  publicKey: Uint8Array;
  utxos: Utxo[];
  payTo: { address: string; amount: bigint };
  changeAddress: string;
  feeRate: number;
  memo?: Uint8Array;
  memoAfterChange?: boolean;
}): UnsignedSpend {
  if (input.payTo.amount < DUST_SATS) throw new Error('That Bitcoin amount is below the dust limit.');
  const script = paymentScript(input.publicKey);
  const extras = input.memo ? [{ script: scriptPush(input.memo), amount: 0n }] : [];
  let fee = BigInt(input.feeRate) * guessVsize(2, extras.length + 2);
  let last: UnsignedSpend | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const selected: Utxo[] = [];
    let sum = 0n;
    for (const utxo of input.utxos) {
      selected.push(utxo);
      sum += BigInt(utxo.value);
      const feeIfChange = BigInt(input.feeRate) * guessVsize(selected.length, extras.length + 2);
      const feeIfDrop = BigInt(input.feeRate) * guessVsize(selected.length, extras.length + 1);
      if (sum >= input.payTo.amount + feeIfChange + DUST_SATS) {
        fee = feeIfChange;
        break;
      }
      if (sum >= input.payTo.amount + feeIfDrop) {
        fee = feeIfDrop;
        break;
      }
    }
    if (sum < input.payTo.amount + fee) {
      throw new Error('Not enough Bitcoin for that amount and the network fee.');
    }
    let change = sum - input.payTo.amount - fee;
    const outputs = extras.length + (change >= DUST_SATS ? 2 : 1);
    fee = BigInt(input.feeRate) * guessVsize(selected.length, outputs);
    if (sum < input.payTo.amount + fee) {
      throw new Error('Not enough Bitcoin for that amount and the network fee.');
    }
    change = sum - input.payTo.amount - fee;
    const keepChange = change >= DUST_SATS;
    if (!keepChange) {
      fee += change;
      change = 0n;
    }

    const tx = new Transaction({ allowUnknownOutputs: extras.length > 0 });
    for (const utxo of selected) {
      tx.addInput({
        txid: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script, amount: BigInt(utxo.value) },
      });
    }
    tx.addOutputAddress(input.payTo.address, input.payTo.amount, NETWORK);
    let changeIndex: number | null = null;
    if (input.memoAfterChange && keepChange) {
      changeIndex = tx.addOutputAddress(input.changeAddress, change, NETWORK);
    }
    for (const extra of extras) tx.addOutput({ script: extra.script, amount: extra.amount });
    if (!input.memoAfterChange && keepChange) {
      changeIndex = tx.addOutputAddress(input.changeAddress, change, NETWORK);
    }
    const vsize = placeholderVsize(tx, input.publicKey);
    const exact = BigInt(input.feeRate) * BigInt(vsize);
    last = { tx, feeSats: fee, changeIndex };
    if (exact === fee || attempt === 3) return last;
    fee = exact;
  }
  if (!last) throw new Error('Could not build the Bitcoin transaction.');
  return last;
}

type PhrasePayer = { kind: 'phrase'; keys: ChainKeys; address: string; publicKey: Uint8Array };
type LedgerPayer = {
  kind: 'ledger';
  address: string;
  publicKey: Uint8Array;
  fingerprint: string;
  accountXpub: string;
};
type BtcPayer = PhrasePayer | LedgerPayer;

function wipeKeys(keys: ChainKeys | undefined): void {
  keys?.btcPrivateKey.fill(0);
  keys?.solPrivateKey.fill(0);
}

function openPayer(): BtcPayer {
  const ledger = getLedgerSession();
  if (ledger) {
    if (!ledger.btcAddress || !ledger.btcPublicKey || !ledger.btcFingerprint || !ledger.btcAccountXpub) {
      throw new Error('Add the Bitcoin account from the home screen. Open the Bitcoin app on the Ledger.');
    }
    return {
      kind: 'ledger',
      address: ledger.btcAddress,
      publicKey: ethers.getBytes(`0x${ledger.btcPublicKey}`),
      fingerprint: ledger.btcFingerprint,
      accountXpub: ledger.btcAccountXpub,
    };
  }
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) {
    throw new Error('Bitcoin sends need the recovery phrase. A private-key import cannot sign Bitcoin.');
  }
  const keys = deriveChainKeys(mnemonic);
  return { kind: 'phrase', keys, address: keys.btcAddress, publicKey: keys.btcPublicKey };
}

function hash160(publicKey: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.ripemd160(ethers.sha256(publicKey)));
}

async function fetchRawTx(txid: string): Promise<Uint8Array | null> {
  try {
    const res = await networkFetch(`${MEMPOOL}/api/tx/${txid}/hex`);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) return null;
    return ethers.getBytes(`0x${text}`);
  } catch {
    return null;
  }
}

async function signLedgerSpend(tx: Transaction, changeIndex: number | null, payer: LedgerPayer): Promise<BuiltTx> {
  const path = BTC_ADDRESS_PATH;
  const fingerprint = Number.parseInt(payer.fingerprint, 16);
  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i);
    if (!input.txid) throw new Error('This Bitcoin input has no transaction id.');
    const txid = hex.encode(input.txid);
    const raw = await fetchRawTx(txid);
    tx.updateInput(i, {
      bip32Derivation: [[payer.publicKey, { fingerprint, path }]],
      ...(raw ? { nonWitnessUtxo: raw } : {}),
    });
  }
  if (changeIndex != null) {
    tx.updateOutput(changeIndex, {
      bip32Derivation: [[payer.publicKey, { fingerprint, path }]],
    });
  }
  const { signPsbtOnLedger } = await import('../ledger/bitcoin');
  const signatures = await signPsbtOnLedger(tx.toPSBT(2), payer);
  const script = OutScript.encode({ type: 'pkh', hash: hash160(payer.publicKey) });
  if (signatures.length !== tx.inputsLength) {
    throw new Error('Ledger did not sign every Bitcoin input.');
  }
  for (const part of signatures) {
    if (hex.encode(part.publicKey) !== hex.encode(payer.publicKey)) {
      throw new Error('Ledger returned a Bitcoin signature for a different key.');
    }
    if (part.signature[part.signature.length - 1] !== 1) {
      throw new Error('Ledger returned a Bitcoin signature this wallet cannot use.');
    }
    const spent = tx.getInput(part.inputIndex).witnessUtxo?.amount;
    if (spent == null) throw new Error('Could not check the Bitcoin signature.');
    const sighash = tx.preimageWitnessV0(part.inputIndex, script, 1, spent);
    const der = part.signature.subarray(0, part.signature.length - 1);
    const valid = secp256k1.verify(der, sighash, payer.publicKey, { prehash: false, format: 'der' });
    if (!valid) throw new Error('Ledger returned a Bitcoin signature this wallet cannot use.');
    tx.updateInput(part.inputIndex, { partialSig: [[payer.publicKey, part.signature]] }, true);
  }
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, feeSats: tx.fee, outputIndex: 0 };
}

async function spend(input: {
  payer: BtcPayer;
  utxos: Utxo[];
  payTo: { address: string; amount: bigint };
  feeRate: number;
  memo?: Uint8Array;
  memoAfterChange?: boolean;
}): Promise<BuiltTx> {
  if (input.payer.kind === 'phrase') {
    return buildSignedTx({
      publicKey: input.payer.publicKey,
      privateKey: input.payer.keys.btcPrivateKey,
      utxos: input.utxos,
      payTo: input.payTo,
      changeAddress: input.payer.address,
      feeRate: input.feeRate,
      memo: input.memo,
      memoAfterChange: input.memoAfterChange,
    });
  }
  const planned = buildUnsignedSpend({
    publicKey: input.payer.publicKey,
    utxos: input.utxos,
    payTo: input.payTo,
    changeAddress: input.payer.address,
    feeRate: input.feeRate,
    memo: input.memo,
    memoAfterChange: input.memoAfterChange,
  });
  const signed = await signLedgerSpend(planned.tx, planned.changeIndex, input.payer);
  return { ...signed, feeSats: planned.feeSats };
}

/** Fee for a transaction that is not broadcast. A Ledger quote does not ask the Nano to sign. */
export async function quoteBtcFee(to: string, amount: string): Promise<bigint> {
  const payer = openPayer();
  try {
    const destination = assertBtcAddress(to);
    const sats = parseBtc(amount);
    const [utxos, rate] = await Promise.all([fetchUtxos(payer.address), fetchFeeRate()]);
    if (payer.kind === 'ledger') {
      return buildUnsignedSpend({
        publicKey: payer.publicKey,
        utxos,
        payTo: { address: destination, amount: sats },
        changeAddress: payer.address,
        feeRate: rate,
      }).feeSats;
    }
    return buildSignedTx({
      publicKey: payer.publicKey,
      privateKey: payer.keys.btcPrivateKey,
      utxos,
      payTo: { address: destination, amount: sats },
      changeAddress: payer.address,
      feeRate: rate,
    }).feeSats;
  } finally {
    if (payer.kind === 'phrase') wipeKeys(payer.keys);
  }
}

/** Spend every coin except the miner fee. */
export async function maxSendableBtc(address: string): Promise<bigint> {
  const [utxos, rate] = await Promise.all([fetchUtxos(address), fetchFeeRate()]);
  const sum = utxos.reduce((total, utxo) => total + BigInt(utxo.value), 0n);
  if (sum === 0n) return 0n;
  const fee = BigInt(rate) * guessVsize(utxos.length, 1);
  const max = sum - fee;
  return max >= DUST_SATS ? max : 0n;
}

export async function sendBtc(to: string, amount: string): Promise<{ txid: string }> {
  const payer = openPayer();
  try {
    const destination = assertBtcAddress(to);
    if (destination === payer.address) throw new Error('That is this wallet’s Bitcoin address.');
    const sats = parseBtc(amount);
    const [utxos, rate] = await Promise.all([fetchUtxos(payer.address), fetchFeeRate()]);
    const built = await spend({
      payer,
      utxos,
      payTo: { address: destination, amount: sats },
      feeRate: rate,
    });
    const txid = await broadcastTx(built.hex);
    if (txid !== built.txid && !/^[0-9a-f]{64}$/i.test(txid)) {
      throw new Error(txid || 'Bitcoin rejected the transaction.');
    }
    return { txid: /^[0-9a-f]{64}$/i.test(txid) ? txid : built.txid };
  } finally {
    if (payer.kind === 'phrase') wipeKeys(payer.keys);
  }
}

/** Signed send with an optional OP_RETURN. Change returns to this wallet. */
export async function sendBtcPayment(input: {
  to: string;
  sats: bigint;
  memo?: Uint8Array;
  memoAfterChange?: boolean;
  feeRate?: number;
}): Promise<{ txid: string; feeSats: bigint; address: string }> {
  const payer = openPayer();
  try {
    const destination = assertBtcAddress(input.to);
    if (destination === payer.address) throw new Error('That is this wallet’s Bitcoin address.');
    if (input.sats < DUST_SATS) throw new Error('That Bitcoin amount is below the dust limit.');
    const [utxos, liveRate] = await Promise.all([fetchUtxos(payer.address), fetchFeeRate()]);
    const feeRate = Math.max(1, liveRate, input.feeRate ?? 1);
    const built = await spend({
      payer,
      utxos,
      payTo: { address: destination, amount: input.sats },
      feeRate,
      memo: input.memo,
      memoAfterChange: input.memoAfterChange,
    });
    const txid = await broadcastTx(built.hex);
    if (txid !== built.txid && !/^[0-9a-f]{64}$/i.test(txid)) {
      throw new Error(txid || 'Bitcoin rejected the transaction.');
    }
    return {
      txid: /^[0-9a-f]{64}$/i.test(txid) ? txid : built.txid,
      feeSats: built.feeSats,
      address: payer.address,
    };
  } finally {
    if (payer.kind === 'phrase') wipeKeys(payer.keys);
  }
}

/** Largest payment that still leaves the miner fee, including an OP_RETURN output. */
export async function maxBtcPayment(input: { memoBytes?: number; feeRate?: number } = {}): Promise<bigint> {
  const payer = openPayer();
  try {
    const [utxos, liveRate] = await Promise.all([fetchUtxos(payer.address), fetchFeeRate()]);
    const sum = utxos.reduce((total, utxo) => total + BigInt(utxo.value), 0n);
    if (sum === 0n || utxos.length === 0) return 0n;
    const rate = Math.max(1, liveRate, input.feeRate ?? 1);
    const outputs = input.memoBytes ? 2 : 1;
    const fee = BigInt(rate) * guessVsize(utxos.length, outputs);
    const max = sum - fee;
    return max >= DUST_SATS ? max : 0n;
  } finally {
    if (payer.kind === 'phrase') wipeKeys(payer.keys);
  }
}

export function btcTxUrl(txid: string): string {
  return `${MEMPOOL}/tx/${txid}`;
}
