import { Address, NETWORK, Transaction, p2wpkh } from '@scure/btc-signer';
import { getSessionMnemonic } from '../sessionVault';
import { BTC_DECIMALS, DUST_SATS, MEMPOOL } from './chains';
import { deriveChainKeys } from './derive';
import { networkFetch } from './http';
import { formatUnits, parseUnits } from './units';

export type Utxo = { txid: string; vout: number; value: number };

type BuiltTx = { hex: string; txid: string; feeSats: bigint };

function paymentScript(publicKey: Uint8Array): Uint8Array {
  const payment = p2wpkh(publicKey, NETWORK);
  if (!payment.script) throw new Error('Could not build the Bitcoin spend script.');
  return payment.script;
}

function guessVsize(inputs: number, outputs: number): bigint {
  return BigInt(11 + inputs * 68 + outputs * 43);
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

/** Miner fee for a plain send. Includes a change output when the leftover is above dust. */
export function estimateSpend(utxos: Utxo[], amount: bigint, feeRate: number): bigint {
  let sum = 0n;
  let count = 0;
  for (const utxo of utxos) {
    count += 1;
    sum += BigInt(utxo.value);
    const fee = BigInt(feeRate) * guessVsize(count, 2);
    if (sum >= amount + fee + DUST_SATS) return fee;
  }
  return BigInt(feeRate) * guessVsize(Math.max(1, count), 2);
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
 * Signed native-segwit send. Same coin selection as the Hemi app, without an OP_RETURN.
 */
export function buildSignedTx(input: {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  utxos: Utxo[];
  payTo: { address: string; amount: bigint };
  changeAddress: string;
  feeRate: number;
}): BuiltTx {
  if (input.payTo.amount < DUST_SATS) throw new Error('That Bitcoin amount is below the dust limit.');
  const script = paymentScript(input.publicKey);
  let fee = BigInt(input.feeRate) * guessVsize(2, 2);
  let last: BuiltTx | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const selected: Utxo[] = [];
    let sum = 0n;
    for (const utxo of input.utxos) {
      selected.push(utxo);
      sum += BigInt(utxo.value);
      const feeIfChange = BigInt(input.feeRate) * guessVsize(selected.length, 2);
      const feeIfDrop = BigInt(input.feeRate) * guessVsize(selected.length, 1);
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
    const outputs = change >= DUST_SATS ? 2 : 1;
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

    const tx = new Transaction();
    for (const utxo of selected) {
      tx.addInput({
        txid: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script, amount: BigInt(utxo.value) },
      });
    }
    tx.addOutputAddress(input.payTo.address, input.payTo.amount, NETWORK);
    if (keepChange) tx.addOutputAddress(input.changeAddress, change, NETWORK);
    tx.sign(input.privateKey);
    tx.finalize();
    const vsize = Math.ceil(tx.weight / 4);
    const exact = BigInt(input.feeRate) * BigInt(vsize);
    last = { hex: tx.hex, txid: tx.id, feeSats: fee };
    if (exact === fee || attempt === 3) return last;
    fee = exact;
  }
  if (!last) throw new Error('Could not build the Bitcoin transaction.');
  return last;
}

function requirePhraseKeys() {
  const mnemonic = getSessionMnemonic();
  if (!mnemonic) {
    throw new Error('Bitcoin sends need the recovery phrase. A Ledger or a private-key import cannot sign Bitcoin here.');
  }
  return deriveChainKeys(mnemonic);
}

/** Fee for a real signed transaction that is not broadcast. */
export async function quoteBtcFee(to: string, amount: string): Promise<bigint> {
  const keys = requirePhraseKeys();
  try {
    const destination = assertBtcAddress(to);
    const sats = parseBtc(amount);
    const [utxos, rate] = await Promise.all([fetchUtxos(keys.btcAddress), fetchFeeRate()]);
    return buildSignedTx({
      publicKey: keys.btcPublicKey,
      privateKey: keys.btcPrivateKey,
      utxos,
      payTo: { address: destination, amount: sats },
      changeAddress: keys.btcAddress,
      feeRate: rate,
    }).feeSats;
  } finally {
    keys.btcPrivateKey.fill(0);
    keys.solPrivateKey.fill(0);
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
  const keys = requirePhraseKeys();
  try {
    const destination = assertBtcAddress(to);
    if (destination === keys.btcAddress) throw new Error('That is this wallet’s Bitcoin address.');
    const sats = parseBtc(amount);
    const [utxos, rate] = await Promise.all([fetchUtxos(keys.btcAddress), fetchFeeRate()]);
    const built = buildSignedTx({
      publicKey: keys.btcPublicKey,
      privateKey: keys.btcPrivateKey,
      utxos,
      payTo: { address: destination, amount: sats },
      changeAddress: keys.btcAddress,
      feeRate: rate,
    });
    const txid = await broadcastTx(built.hex);
    if (txid !== built.txid && !/^[0-9a-f]{64}$/i.test(txid)) {
      throw new Error(txid || 'Bitcoin rejected the transaction.');
    }
    return { txid: /^[0-9a-f]{64}$/i.test(txid) ? txid : built.txid };
  } finally {
    keys.btcPrivateKey.fill(0);
    keys.solPrivateKey.fill(0);
  }
}

export function btcTxUrl(txid: string): string {
  return `${MEMPOOL}/tx/${txid}`;
}
