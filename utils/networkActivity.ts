/** Transfers and tunnel history for the selected network. */

import { formatRawAmount } from './ethHoldings';
import { readEthereumActivity, type EthActivityRow } from './ethActivity';
import { btcTxUrl, findBtcCredit, formatBtc } from './networks/btc';
import { HEMI_EXPLORER, MEMPOOL } from './networks/chains';
import {
  ethTunnelStep,
  ethTxUrl,
  readEthInclusion,
  readEthMoves,
  readWithdrawalStage,
  withdrawalFields,
  type EthMove,
} from './networks/ethBridge';
import { networkFetch } from './networks/http';
import { readHemiMined } from './networks/hemi';
import { readJupBridgeMoves } from './networks/jupBridge';
import { formatLifi, lifiOutcome, lifiStep, readLifiMoves, readLifiStatus, type LifiMove } from './networks/lifiSwap';
import { solTxUrl, solanaRpc } from './networks/solana';
import { readStargateMoves, readStargateStage, stargateStep, type StargateMove } from './networks/stargate';
import { formatUnits } from './networks/units';
import {
  btcTunnelStep,
  readBtcConfirmations,
  readDepositAcknowledged,
  readTunnelMoves,
  readVault,
  type TunnelMove,
} from './networks/tunnel';

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
  /** Open bridge step. The Tunnels tab shows a spinner beside this row. */
  spinning?: boolean;
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

async function btcTunnelLive(move: TunnelMove, need: number, stateAddress: string | undefined): Promise<{
  subtitle: string;
  spinning: boolean;
}> {
  if (move.status === 'minted') return { subtitle: 'Done · hemiBTC minted', spinning: false };
  if (move.status === 'paid') return { subtitle: 'Done · Bitcoin paid out', spinning: false };
  if (move.status !== 'broadcast') return { subtitle: `hemiBTC · ${move.status}`, spinning: false };
  try {
    if (move.direction === 'to-hemi') {
      let acknowledged: boolean | undefined;
      if (stateAddress) {
        try { acknowledged = await readDepositAcknowledged(stateAddress, move.txHash); } catch { acknowledged = undefined; }
      }
      let confirmations: number | null = null;
      if (acknowledged !== true) {
        try { confirmations = await readBtcConfirmations(move.txHash); } catch { confirmations = null; }
      }
      const named = btcTunnelStep(move, { confirmations, acknowledged, mined: undefined, need });
      return { subtitle: named.step, spinning: named.spinning };
    }
    let mined: boolean | null = null;
    try { mined = await readHemiMined(move.txHash); } catch { mined = null; }
    if (mined) {
      const paid = await findBtcCredit(move.btcAddress, move.createdAt, BigInt(move.netSats || '0')).catch(() => false);
      if (paid) return { subtitle: 'Done · Bitcoin paid out', spinning: false };
    }
    const named = btcTunnelStep(move, { confirmations: null, acknowledged: undefined, mined, need });
    return { subtitle: named.step, spinning: named.spinning };
  } catch {
    return { subtitle: 'Checking the Bitcoin tunnel', spinning: true };
  }
}

async function ethTunnelLive(move: EthMove): Promise<{ subtitle: string; spinning: boolean; failed: boolean }> {
  if (move.status === 'credited') return { subtitle: 'Done · ETH is on Hemi', spinning: false, failed: false };
  if (move.status === 'finalized') return { subtitle: 'Done · ETH is on Ethereum', spinning: false, failed: false };
  const open = move.status === 'submitted' || move.status === 'proven';
  if (!open) return { subtitle: `ETH tunnel · ${move.status}`, spinning: false, failed: false };
  try {
    if (move.direction === 'to-hemi') {
      const inclusion = await readEthInclusion(move.txHash);
      const named = ethTunnelStep(move, inclusion, undefined);
      return { subtitle: named.step, spinning: named.spinning, failed: named.failed };
    }
    const fields = withdrawalFields(move);
    if (!fields || move.l2Block == null) return { subtitle: 'Checking the portal', spinning: true, failed: false };
    const stage = await readWithdrawalStage(fields, move.l2Block);
    const named = ethTunnelStep(move, undefined, stage);
    return { subtitle: named.step, spinning: named.spinning, failed: named.failed };
  } catch {
    return { subtitle: 'Checking the ETH tunnel', spinning: true, failed: false };
  }
}

async function stargateLive(move: StargateMove): Promise<{ subtitle: string; spinning: boolean; failed: boolean }> {
  if (move.status === 'delivered') {
    const to = move.direction === 'to-hemi' ? 'Hemi' : 'Ethereum';
    return { subtitle: `Done · ETH is on ${to}`, spinning: false, failed: false };
  }
  if (move.status === 'failed') return { subtitle: 'Stargate failed', spinning: false, failed: true };
  try {
    const named = stargateStep(move.direction, await readStargateStage(move.txHash));
    return { subtitle: named.step, spinning: named.spinning, failed: named.failed };
  } catch {
    return { subtitle: 'Checking Stargate', spinning: true, failed: false };
  }
}

async function lifiLive(move: LifiMove): Promise<{ subtitle: string; spinning: boolean; failed: boolean }> {
  const label = move.toolLabel || 'LI.FI';
  if (move.status === 'done') return { subtitle: `${label} · Paid out`, spinning: false, failed: false };
  if (move.status === 'refunded') return { subtitle: `${label} · Refunded`, spinning: false, failed: false };
  if (move.status === 'failed') return { subtitle: `${label} · Swap failed`, spinning: false, failed: true };
  try {
    const status = await readLifiStatus(move);
    const named = lifiStep(status, label);
    const outcome = lifiOutcome(status);
    return {
      subtitle: named.step,
      spinning: outcome === 'pending',
      failed: outcome === 'failed',
    };
  } catch {
    return { subtitle: `Waiting for ${label} to see this transaction`, spinning: true, failed: false };
  }
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
    let need = 6;
    let stateAddress: string | undefined;
    if (moves.some((move) => move.status === 'broadcast' && move.direction === 'to-hemi')) {
      try {
        const vault = await readVault();
        need = vault.confirmations;
        stateAddress = vault.stateAddress;
      } catch { /* confirmations fall back to 6 */ }
    }
    const live = await Promise.all(moves.map((move) => btcTunnelLive(move, need, stateAddress)));
    moves.forEach((move, index) => {
      const sats = BigInt(move.grossSats || '0');
      const step = live[index];
      rows.push({
        id: `btc-tunnel:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'to-hemi' ? 'Bitcoin → Hemi' : 'Hemi → Bitcoin',
        subtitle: step?.subtitle || `hemiBTC · ${move.status}`,
        amount: `${formatBtc(sats)} BTC`,
        tone: 'swap',
        url: move.direction === 'to-hemi' ? btcTxUrl(move.txHash) : hemiTxUrl(move.txHash),
        symbol: 'HEMIBTC',
        spinning: step?.spinning,
      });
    });
  }

  if ((chain === 'ethereum' || chain === 'hemi') && eth) {
    const [moves, stargate] = await Promise.all([
      readEthMoves(eth),
      readStargateMoves(eth),
    ]);
    const live = await Promise.all(moves.map((move) => ethTunnelLive(move)));
    moves.forEach((move, index) => {
      const step = live[index];
      rows.push({
        id: `eth-tunnel:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'to-hemi' ? 'Ethereum → Hemi' : 'Hemi → Ethereum',
        subtitle: step?.subtitle || `ETH tunnel · ${move.status}`,
        amount: `${formatRawAmount(BigInt(move.amountWei || '0'), 18, 6)} ETH`,
        tone: step?.failed ? 'fail' : 'swap',
        url: move.direction === 'to-hemi' ? ethTxUrl(move.txHash) : hemiTxUrl(move.txHash),
        symbol: 'ETH',
        spinning: step?.spinning,
      });
    });
    const stargateLiveRows = await Promise.all(stargate.map((move) => stargateLive(move)));
    stargate.forEach((move, index) => {
      const step = stargateLiveRows[index];
      rows.push({
        id: `stargate:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'to-hemi' ? 'Stargate · Ethereum → Hemi' : 'Stargate · Hemi → Ethereum',
        subtitle: step?.subtitle || 'Checking Stargate',
        amount: `${formatRawAmount(BigInt(move.amountIn || '0'), 18, 6)} ETH`,
        tone: step?.failed ? 'fail' : 'swap',
        url: `https://layerzeroscan.com/tx/${move.txHash}`,
        symbol: 'ETH',
        spinning: step?.spinning,
      });
    });
  }

  if ((chain === 'solana' || chain === 'bitcoin') && (sol || btc)) {
    const moves = await readLifiMoves(sol, btc);
    const live = await Promise.all(moves.map((move) => lifiLive(move)));
    moves.forEach((move, index) => {
      const asset = move.fromChain === 'sol' ? 'SOL' : 'BTC';
      const step = live[index];
      rows.push({
        id: `lifi:${move.id}`,
        time: move.createdAt,
        title: move.direction === 'sol-to-btc' ? 'Solana → Bitcoin' : 'Bitcoin → Solana',
        subtitle: step?.subtitle || `${move.toolLabel || 'LI.FI'} · ${move.status}`,
        amount: `${formatLifi(BigInt(move.amountIn || '0'), asset)} ${asset}`,
        tone: step?.failed || move.status === 'failed' ? 'fail' : 'swap',
        url: move.fromChain === 'sol' ? solTxUrl(move.txHash) : btcTxUrl(move.txHash),
        symbol: asset,
        spinning: step?.spinning,
      });
    });
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
