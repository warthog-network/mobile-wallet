/** Ethereum mainnet activity for this wallet: ETH, USDT, and SushiSwap swaps. */

import { formatRawAmount } from './ethHoldings';
import { ETH_USDT, SUSHI_ROUTER } from './ethTokens';

const ROUTESCAN = 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';
const PAGE = '40';
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const APPROVE = '0x095ea7b3';

export interface EthActivityRow {
  id: string;
  hash: string;
  time: number;
  title: string;
  subtitle: string;
  amount: string;
  tone: 'in' | 'out' | 'swap' | 'fail';
  symbol?: 'ETH' | 'USDT';
  paySymbol?: 'ETH' | 'USDT';
  receiveSymbol?: 'ETH' | 'USDT';
}

interface ChainTx {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
  input?: string;
  contractAddress?: string;
}

export interface EthActivityResult {
  rows: EthActivityRow[];
  warning: string | null;
}

function lower(value: string | undefined): string {
  return (value || '').toLowerCase();
}

function wei(value: string | undefined): bigint {
  try {
    return BigInt(value || '0');
  } catch {
    return 0n;
  }
}

function short(addr: string | undefined): string {
  const text = addr || '';
  if (text.length < 12) return text || 'Ethereum';
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function failed(tx: ChainTx): boolean {
  return tx.isError === '1' || tx.txreceipt_status === '0';
}

function asList(body: unknown): ChainTx[] {
  if (!body || typeof body !== 'object') throw new Error('Ethereum activity is unavailable.');
  const result = (body as { result?: unknown }).result;
  if (Array.isArray(result)) return result as ChainTx[];
  if (typeof result === 'string' && /no transactions/i.test(result)) return [];
  if (typeof result === 'string' && result.trim()) throw new Error(result);
  throw new Error('Ethereum activity is unavailable.');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ethereum activity timed out.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function fetchAction(action: string, address: string, extra: Record<string, string> = {}): Promise<ChainTx[]> {
  const params = new URLSearchParams({
    module: 'account',
    action,
    address,
    page: '1',
    offset: PAGE,
    sort: 'desc',
    ...extra,
  });
  const response = await withTimeout(
    fetch(`${ROUTESCAN}?${params}`, { headers: { accept: 'application/json' } }),
    15000,
  );
  if (!response.ok) throw new Error(`Activity request failed (${response.status}).`);
  return asList(await response.json());
}

/** Turn explorer rows into one list. Swaps collapse the ETH and USDT legs of the same hash. */
export function buildEthereumActivity(address: string, txs: ChainTx[], tokens: ChainTx[], internals: ChainTx[]): EthActivityRow[] {
  const me = lower(address);
  const router = SUSHI_ROUTER.toLowerCase();
  const usdt = ETH_USDT.toLowerCase();
  const rows: EthActivityRow[] = [];
  const used = new Set<string>();

  const usdtByHash = new Map<string, ChainTx[]>();
  for (const tx of tokens) {
    if (tx.contractAddress && lower(tx.contractAddress) !== usdt) continue;
    const hash = lower(tx.hash);
    if (!hash) continue;
    const list = usdtByHash.get(hash) ?? [];
    list.push(tx);
    usdtByHash.set(hash, list);
  }

  for (const tx of txs) {
    const hash = lower(tx.hash);
    if (!hash) continue;
    const from = lower(tx.from);
    const to = lower(tx.to);
    const time = Number(tx.timeStamp) || 0;
    const value = wei(tx.value);
    const bad = failed(tx);

    if (from === me && to === router) {
      used.add(hash);
      const legs = usdtByHash.get(hash) ?? [];
      const usdtIn = legs.filter((leg) => lower(leg.to) === me).reduce((sum, leg) => sum + wei(leg.value), 0n);
      const usdtOut = legs.filter((leg) => lower(leg.from) === me).reduce((sum, leg) => sum + wei(leg.value), 0n);
      const ethIn = internals
        .filter((leg) => lower(leg.hash) === hash && lower(leg.to) === me && leg.isError !== '1')
        .reduce((sum, leg) => sum + wei(leg.value), 0n);
      const payEth = value > 0n;
      const pay = payEth ? `${formatRawAmount(value, 18, 6)} ETH` : `${formatRawAmount(usdtOut, 6, 6)} USDT`;
      const received = usdtIn > 0n
        ? `${formatRawAmount(usdtIn, 6, 6)} USDT`
        : ethIn > 0n
          ? `${formatRawAmount(ethIn, 18, 6)} ETH`
          : '';
      rows.push({
        id: `${hash}:swap`,
        hash: tx.hash || hash,
        time,
        title: bad ? 'Swap failed' : 'Swapped',
        subtitle: payEth ? 'SushiSwap · ETH → USDT' : 'SushiSwap · USDT → ETH',
        amount: bad || !received ? pay : `${pay} → ${received}`,
        tone: bad ? 'fail' : 'swap',
        paySymbol: payEth ? 'ETH' : 'USDT',
        receiveSymbol: usdtIn > 0n ? 'USDT' : 'ETH',
      });
      continue;
    }

    const input = lower(tx.input);
    if (from === me && to === usdt && input.startsWith(APPROVE)) {
      used.add(hash);
      const cleared = input.endsWith('0'.repeat(64));
      rows.push({
        id: `${hash}:approve`,
        hash: tx.hash || hash,
        time,
        title: bad ? 'Approval failed' : cleared ? 'Cleared USDT approval' : 'Approved USDT',
        subtitle: 'SushiSwap',
        amount: 'USDT',
        tone: bad ? 'fail' : 'out',
        symbol: 'USDT',
      });
      continue;
    }

    if (value > 0n && from === me) {
      used.add(hash);
      rows.push({
        id: `${hash}:eth`,
        hash: tx.hash || hash,
        time,
        title: bad ? 'ETH send failed' : 'Sent ETH',
        subtitle: short(tx.to),
        amount: `− ${formatRawAmount(value, 18, 6)} ETH`,
        tone: bad ? 'fail' : 'out',
        symbol: 'ETH',
      });
    } else if (value > 0n && to === me) {
      used.add(hash);
      rows.push({
        id: `${hash}:eth`,
        hash: tx.hash || hash,
        time,
        title: bad ? 'ETH receive failed' : 'Received ETH',
        subtitle: short(tx.from),
        amount: `+ ${formatRawAmount(value, 18, 6)} ETH`,
        tone: bad ? 'fail' : 'in',
        symbol: 'ETH',
      });
    }
  }

  const usdtGroups = new Map<string, { inn: bigint; out: bigint; time: number; hash: string; counterparty: string }>();
  for (const tx of tokens) {
    const hash = lower(tx.hash);
    if (!hash || used.has(hash)) continue;
    if (tx.contractAddress && lower(tx.contractAddress) !== usdt) continue;
    const from = lower(tx.from);
    const to = lower(tx.to);
    if (from !== me && to !== me) continue;
    const current = usdtGroups.get(hash) ?? {
      inn: 0n,
      out: 0n,
      time: Number(tx.timeStamp) || 0,
      hash: tx.hash || hash,
      counterparty: from === me ? tx.to || '' : tx.from || '',
    };
    if (from === me) current.out += wei(tx.value);
    if (to === me) current.inn += wei(tx.value);
    usdtGroups.set(hash, current);
  }
  for (const [hash, group] of usdtGroups) {
    used.add(hash);
    const outgoing = group.out > group.inn;
    const amount = outgoing ? group.out - group.inn : group.inn - group.out;
    if (amount <= 0n) continue;
    rows.push({
      id: `${hash}:usdt`,
      hash: group.hash,
      time: group.time,
      title: outgoing ? 'Sent USDT' : 'Received USDT',
      subtitle: short(group.counterparty),
      amount: `${outgoing ? '−' : '+'} ${formatRawAmount(amount, 6, 6)} USDT`,
      tone: outgoing ? 'out' : 'in',
      symbol: 'USDT',
    });
  }

  const ethIn = new Map<string, { value: bigint; from: string; time: number; hash: string }>();
  for (const tx of internals) {
    const hash = lower(tx.hash);
    if (!hash || used.has(hash) || tx.isError === '1' || lower(tx.to) !== me) continue;
    const value = wei(tx.value);
    if (value <= 0n) continue;
    const current = ethIn.get(hash) ?? { value: 0n, from: tx.from || '', time: Number(tx.timeStamp) || 0, hash: tx.hash || hash };
    current.value += value;
    ethIn.set(hash, current);
  }
  for (const [hash, group] of ethIn) {
    used.add(hash);
    rows.push({
      id: `${hash}:internal`,
      hash: group.hash,
      time: group.time,
      title: 'Received ETH',
      subtitle: short(group.from),
      amount: `+ ${formatRawAmount(group.value, 18, 6)} ETH`,
      tone: 'in',
      symbol: 'ETH',
    });
  }

  rows.sort((a, b) => b.time - a.time || a.hash.localeCompare(b.hash));
  return rows.slice(0, 50);
}

export async function readEthereumActivity(address: string): Promise<EthActivityResult> {
  if (!ADDRESS.test(address)) {
    return { rows: [], warning: 'This wallet has no Ethereum account.' };
  }
  const [txResult, tokenResult, internalResult] = await Promise.allSettled([
    fetchAction('txlist', address),
    fetchAction('tokentx', address, { contractaddress: ETH_USDT }),
    fetchAction('txlistinternal', address),
  ]);
  if (txResult.status === 'rejected' && tokenResult.status === 'rejected') {
    const reason = txResult.reason;
    throw new Error(reason instanceof Error ? reason.message : 'Ethereum activity is unavailable.');
  }
  const warning = tokenResult.status === 'rejected'
    ? 'USDT transfers could not be loaded.'
    : txResult.status === 'rejected'
      ? 'Some ETH transfers could not be loaded.'
      : null;
  return {
    rows: buildEthereumActivity(
      address,
      txResult.status === 'fulfilled' ? txResult.value : [],
      tokenResult.status === 'fulfilled' ? tokenResult.value : [],
      internalResult.status === 'fulfilled' ? internalResult.value : [],
    ),
    warning,
  };
}
