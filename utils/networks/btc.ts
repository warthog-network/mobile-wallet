import { Address, NETWORK, Transaction, p2wpkh } from '@scure/btc-signer';
import { getSessionMnemonic } from '../sessionVault';
import { BTC_DECIMALS, DUST_SATS, MEMPOOL } from './chains';
import { deriveChainKeys } from './derive';
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
  if (data.length >= 76) throw new Error('Memo is too long for a single OP_RETURN push.');
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
    for (const extra of extras) tx.addOutput({ script: extra.script, amount: extra.amount });
    if (keepChange) tx.addOutputAddress(input.changeAddress, change, NETWORK);
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
