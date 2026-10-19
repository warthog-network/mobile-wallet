/** Transfers and tunnel history for the selected network. */

import { formatRawAmount } from './ethHoldings';
import { readEthereumActivity, type EthActivityRow } from './ethActivity';
import { btcTxUrl, formatBtc } from './networks/btc';
import { HEMI_EXPLORER, MEMPOOL } from './networks/chains';
import { ethTxUrl, readEthMoves } from './networks/ethBridge';
import { networkFetch } from './networks/http';
import { readJupBridgeMoves } from './networks/jupBridge';
import { formatLifi, readLifiMoves } from './networks/lifiSwap';
import { solTxUrl, solanaRpc } from './networks/solana';
import { formatUnits } from './networks/units';
import { readTunnelMoves } from './networks/tunnel';

export type ActivityChain = 'wart' | 'ethereum' | 'bitcoin' | 'hemi' | 'solana';

export type ActivityItem = {
  id: string;
  time: number;
  title: string;
  subtitle: string;
  amount: string;
  tone: 'in' | 'out' | 'swap' | 'fail';
  url: string | null;
  symbol?: string;
};

const HEMI_ROUTESCAN = 'https://api.routescan.io/v2/network/mainnet/evm/43111/etherscan/api';

function hemiTxUrl(hash: string): string {
  return `${HEMI_EXPLORER}/tx/${hash}`;
}

function fromEth(row: EthActivityRow): ActivityItem {
  return {
    id: row.id,
    time: row.time * 1000,
    title: row.title,
    subtitle: row.subtitle,
    amount: row.amount,
    tone: row.tone,
    url: `https://etherscan.io/tx/${row.hash}`,
    symbol: row.symbol || row.paySymbol,
  };
}

type MempoolTx = {
  txid?: string;
  status?: { confirmed?: boolean; block_time?: number };
  vin?: { prevout?: { scriptpubkey_address?: string; value?: number } }[];
  vout?: { scriptpubkey_address?: string; value?: number }[];
};

async function readBitcoinActivity(address: string): Promise<ActivityItem[]> {
  const response = await networkFetch(`${MEMPOOL}/api/address/${address}/txs`);
  if (!response.ok) throw new Error('Bitcoin activity is unavailable.');
  const body = await response.json() as unknown;
  if (!Array.isArray(body)) throw new Error('Bitcoin activity is unavailable.');
  return (body as MempoolTx[]).slice(0, 25).map((tx) => {
    let net = 0n;
    for (const input of tx.vin ?? []) {
      if (input.prevout?.scriptpubkey_address === address) net -= BigInt(Math.trunc(input.prevout.value ?? 0));
    }
    for (const output of tx.vout ?? []) {
      if (output.scriptpubkey_address === address) net += BigInt(Math.trunc(output.value ?? 0));
    }
    const received = net > 0n;
    const txid = tx.txid || '';
    return {
      id: txid,
      time: (tx.status?.block_time || 0) * 1000,
      title: tx.status?.confirmed === false ? 'Bitcoin pending' : received ? 'Received BTC' : 'Sent BTC',
      subtitle: txid ? `${txid.slice(0, 8)}…${txid.slice(-6)}` : 'Bitcoin',
      amount: `${received ? '+' : '−'} ${formatBtc(net < 0n ? -net : net)} BTC`,
      tone: received ? 'in' as const : 'out' as const,
      url: txid ? btcTxUrl(txid) : null,
      symbol: 'BTC',
    };
  });
}

type ScanTx = {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  timeStamp?: string;
  isError?: string;
  txreceipt_status?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  contractAddress?: string;
};

async function scan(action: string, address: string): Promise<ScanTx[]> {
  const params = new URLSearchParams({
    module: 'account',
    action,
    address,
    page: '1',
    offset: '25',
    sort: 'desc',
  });
  const response = await networkFetch(`${HEMI_ROUTESCAN}?${params}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Hemi activity is unavailable.');
  const body = await response.json() as { result?: unknown };
  if (Array.isArray(body.result)) return body.result as ScanTx[];
  if (typeof body.result === 'string' && /no transactions/i.test(body.result)) return [];
  if (typeof body.result === 'string' && body.result.trim()) throw new Error(body.result);
  return [];
}

async function readHemiActivity(address: string): Promise<ActivityItem[]> {
  const [txs, tokens] = await Promise.all([
    scan('txlist', address),
    scan('tokentx', address).catch(() => [] as ScanTx[]),
  ]);
  const me = address.toLowerCase();
  const rows: ActivityItem[] = [];
  for (const tx of txs) {
    const value = BigInt(tx.value || '0');
    if (value <= 0n || !tx.hash) continue;
    const incoming = (tx.to || '').toLowerCase() === me;
    const failed = tx.isError === '1' || tx.txreceipt_status === '0';
    rows.push({
      id: `${tx.hash}:eth`,
      time: (Number(tx.timeStamp) || 0) * 1000,
      title: failed ? 'ETH transfer failed' : incoming ? 'Received ETH' : 'Sent ETH',
      subtitle: 'Hemi',
      amount: `${incoming ? '+' : '−'} ${formatRawAmount(value, 18, 6)} ETH`,
      tone: failed ? 'fail' : incoming ? 'in' : 'out',
      url: hemiTxUrl(tx.hash),
      symbol: 'ETH',
    });
  }
  for (const tx of tokens) {
    if (!tx.hash) continue;
    const decimals = Number(tx.tokenDecimal || '18');
    const symbol = tx.tokenSymbol || 'token';
    let value = 0n;
    try { value = BigInt(tx.value || '0'); } catch { value = 0n; }
    if (value <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    const incoming = (tx.to || '').toLowerCase() === me;
    rows.push({
      id: `${tx.hash}:${(tx.contractAddress || symbol).toLowerCase()}`,
      time: (Number(tx.timeStamp) || 0) * 1000,
      title: incoming ? `Received ${symbol}` : `Sent ${symbol}`,
      subtitle: 'Hemi',
      amount: `${incoming ? '+' : '−'} ${formatRawAmount(value, decimals, 6)} ${symbol}`,
      tone: incoming ? 'in' : 'out',
      url: hemiTxUrl(tx.hash),
      symbol,
    });
  }
  return rows.sort((a, b) => b.time - a.time).slice(0, 40);
}

async function readSolanaActivity(address: string): Promise<ActivityItem[]> {
  const rows = await solanaRpc<{ signature: string; blockTime: number | null; err: unknown }[]>(
    'getSignaturesForAddress',
    [address, { limit: 20 }],
  );
  return rows.map((row) => ({
    id: row.signature,
    time: (row.blockTime || 0) * 1000,
    title: row.err ? 'Solana transaction failed' : 'Solana transaction',
    subtitle: `${row.signature.slice(0, 8)}…${row.signature.slice(-6)}`,
    amount: row.err ? 'Failed' : 'Confirmed',
    tone: row.err ? 'fail' as const : 'out' as const,
    url: solTxUrl(row.signature),
    symbol: 'SOL',
  }));
}

export async function readTransferActivity(
  chain: ActivityChain,
  addresses: { eth?: string; btc?: string; sol?: string },
): Promise<{ rows: ActivityItem[]; warning: string | null }> {
  if (chain === 'wart') return { rows: [], warning: null };
  if (chain === 'ethereum') {
    if (!addresses.eth) return { rows: [], warning: null };
    const next = await readEthereumActivity(addresses.eth);
    return { rows: next.rows.map(fromEth), warning: next.warning };
  }
  if (chain === 'bitcoin') {
    if (!addresses.btc) return { rows: [], warning: null };
    return { rows: await readBitcoinActivity(addresses.btc), warning: null };
  }
  if (chain === 'hemi') {
    if (!addresses.eth) return { rows: [], warning: null };
    return { rows: await readHemiActivity(addresses.eth), warning: null };
  }
  if (!addresses.sol) return { rows: [], warning: null };
  return { rows: await readSolanaActivity(addresses.sol), warning: null };
}

export async function readTunnelActivity(
  chain: ActivityChain,
  addresses: { eth?: string; btc?: string; sol?: string },
): Promise<ActivityItem[]> {
  const rows: ActivityItem[] = [];
  const eth = addresses.eth || '';
  const btc = addresses.btc || '';
  const sol = addresses.sol || '';

  if ((chain === 'bitcoin' || chain === 'hemi') && eth) {
    const moves = await readTunnelMoves(eth);
    for (const move of moves) {
      const sats = BigInt(move.grossSats || '0');
      rows.push({
        id: `btc-tunnel:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'to-hemi' ? 'Bitcoin → Hemi' : 'Hemi → Bitcoin',
        subtitle: `hemiBTC · ${move.status}`,
        amount: `${formatBtc(sats)} BTC`,
        tone: 'swap',
        url: move.direction === 'to-hemi' ? btcTxUrl(move.txHash) : hemiTxUrl(move.txHash),
        symbol: 'HEMIBTC',
      });
    }
  }

  if ((chain === 'ethereum' || chain === 'hemi') && eth) {
    const moves = await readEthMoves(eth);
    for (const move of moves) {
      rows.push({
        id: `eth-tunnel:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'to-hemi' ? 'Ethereum → Hemi' : 'Hemi → Ethereum',
        subtitle: `ETH tunnel · ${move.status}`,
        amount: `${formatRawAmount(BigInt(move.amountWei || '0'), 18, 6)} ETH`,
        tone: 'swap',
        url: move.direction === 'to-hemi' ? ethTxUrl(move.txHash) : hemiTxUrl(move.txHash),
        symbol: 'ETH',
      });
    }
  }

  if ((chain === 'solana' || chain === 'bitcoin') && (sol || btc)) {
    const moves = await readLifiMoves(sol, btc);
    for (const move of moves) {
      const asset = move.fromChain === 'sol' ? 'SOL' : 'BTC';
      rows.push({
        id: `lifi:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'sol-to-btc' ? 'Solana → Bitcoin' : 'Bitcoin → Solana',
        subtitle: `${move.toolLabel || 'LI.FI'} · ${move.status}`,
        amount: `${formatLifi(BigInt(move.amountIn || '0'), asset)} ${asset}`,
        tone: move.status === 'failed' ? 'fail' : 'swap',
        url: move.fromChain === 'sol' ? solTxUrl(move.txHash) : btcTxUrl(move.txHash),
        symbol: asset,
      });
    }
  }

  if ((chain === 'ethereum' || chain === 'solana') && (eth || sol)) {
    const moves = await readJupBridgeMoves(eth, sol);
    for (const move of moves) {
      rows.push({
        id: `jup:${move.id}`,
        time: move.createdAt,
        title: `${move.paySymbol} → ${move.receiveSymbol}`,
        subtitle: `${move.label || 'Relay'} · ${move.fromChain} → ${move.toChain}`,
        amount: `${formatUnits(BigInt(move.amountIn || '0'), move.payDecimals)} ${move.paySymbol}`,
        tone: 'swap',
        url: move.fromChain === 'ethereum' ? ethTxUrl(move.txHash) : solTxUrl(move.txHash),
        symbol: move.paySymbol,
      });
    }
  }

  return rows.sort((a, b) => b.time - a.time);
}
