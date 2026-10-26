import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { defiColors, defiStyles } from '../defi/defiStyles';
import TokenIcon from '../TokenIcon';
import { DEFAULT_FEE } from '../../constants';
import { explainExchangeFailure } from '../../utils/exchange/http';
import {
  loadSafeTradeCredentials,
  SAFE_ROUTES,
  safeBalances,
  safeCancelOrder,
  safeCoinAddressBook,
  safeDepositAddress,
  safeDepth,
  safeLimitOrder,
  safeOpenOrders,
  safePair,
  safePublicNetwork,
  safeSlippagePrice,
  safeSwap,
  safeTicker,
  safeWaitOrder,
  safeWithdrawCoin,
  walkBook,
  type BookFill,
  type SafeDepth,
  type SafeMarket,
  type SafeNetworkLimits,
  type SafeOrder,
  type SafeRoute,
  type SafeTicker,
  type SpotBalance,
  type WartAddressBook,
} from '../../utils/exchange/safetrade';
import { sendEthAsset } from '../../utils/ethChain';
import { readEthereumHoldings } from '../../utils/ethHoldings';
import { sendWartFromWallet } from '../../utils/exchange/walletSend';
import { fetchBtcBalance, formatBtc, maxSendableBtc, sendBtc } from '../../utils/networks/btc';
import { fetchSolBalance, formatSol, maxSolPayment, sendSol } from '../../utils/networks/solana';
import { USDC_MINT, USDT_MINT } from '../../utils/networks/chains';
import { sendSpl } from '../../utils/networks/solswap';
import { formatUnits } from '../../utils/networks/units';
import { readOneBalance } from '../../utils/tokenBalances';
import { isLedgerSession } from '../../utils/sessionVault';
import { isDefiNode } from '../../utils/nodes';
import { NetworkModeBadge } from '../defi/WartMainnetHolding';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';

type Panel = 'swap' | 'limit' | 'move';
type MoveDir = 'deposit' | 'withdraw';
type Book = WartAddressBook | 'error' | null;

type SwapChoice = {
  id: string;
  group: string;
  currency: string;
  symbol: string;
  network: string;
};

type MenuChoice = {
  id: string;
  symbol: string;
  label: string;
  hint?: string;
};

/**
 * Coins on the networks this wallet holds. Hemi is not here: SafeTrade does not list it.
 * USDT and USDC appear on Ethereum and Solana because both are listed and this wallet has both addresses.
 * The card picks a network first, then offers only that network's coins.
 */
const SWAP_CHOICES: SwapChoice[] = [
  { id: 'wart:wart', group: 'Warthog', currency: 'wart', symbol: 'WART', network: 'Warthog' },
  { id: 'ethereum:eth', group: 'Ethereum', currency: 'eth', symbol: 'ETH', network: 'Ethereum' },
  { id: 'ethereum:usdt', group: 'Ethereum', currency: 'usdt', symbol: 'USDT', network: 'Ethereum' },
  { id: 'ethereum:usdc', group: 'Ethereum', currency: 'usdc', symbol: 'USDC', network: 'Ethereum' },
  { id: 'bitcoin:btc', group: 'Bitcoin', currency: 'btc', symbol: 'BTC', network: 'Bitcoin' },
  { id: 'solana:sol', group: 'Solana', currency: 'sol', symbol: 'SOL', network: 'Solana' },
  { id: 'solana:usdt', group: 'Solana', currency: 'usdt', symbol: 'USDT', network: 'Solana' },
  { id: 'solana:usdc', group: 'Solana', currency: 'usdc', symbol: 'USDC', network: 'Solana' },
];

const SLIPPAGE: { bps: number | null; label: string }[] = [
  { bps: null, label: 'Off' },
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
  { bps: 1500, label: '15%' },
];

const BOOK_ROWS = 8;

const NETWORKS: { id: string; symbol: string }[] = [
  { id: 'Warthog', symbol: 'WART' },
  { id: 'Ethereum', symbol: 'ETH' },
  { id: 'Bitcoin', symbol: 'BTC' },
  { id: 'Solana', symbol: 'SOL' },
];

function choiceById(id: string): SwapChoice {
  return SWAP_CHOICES.find((row) => row.id === id) ?? SWAP_CHOICES[0];
}

function networkSymbol(id: string): string {
  return NETWORKS.find((row) => row.id === id)?.symbol ?? 'ETH';
}

function coinsOn(network: string): SwapChoice[] {
  return SWAP_CHOICES.filter((row) => row.network === network);
}

function choiceForCurrency(currency: string, preferNetwork: string): SwapChoice | null {
  const rows = SWAP_CHOICES.filter((row) => row.currency === currency);
  return rows.find((row) => row.network === preferNetwork) ?? rows[0] ?? null;
}

/** Other SafeTrade currencies that trade directly against this one. One row per currency. */
function marketPartners(currency: string, preferNetwork: string): SwapChoice[] {
  const seen = new Set<string>();
  const out: SwapChoice[] = [];
  for (const row of SWAP_CHOICES) {
    if (row.currency === currency || seen.has(row.currency)) continue;
    if (!safePair(currency, row.currency)) continue;
    const pick = choiceForCurrency(row.currency, preferNetwork);
    if (!pick) continue;
    seen.add(row.currency);
    out.push(pick);
  }
  return out;
}

/** Coin menu for one network. A direct-market coin from another network keeps that network as a hint. */
function coinMenu(rows: SwapChoice[], selectedNetwork: string): { title: string; choices: MenuChoice[] }[] {
  return [{
    title: '',
    choices: rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      label: row.symbol,
      hint: row.network === selectedNetwork ? undefined : row.network,
    })),
  }];
}

function formatBalance(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(8).replace(/\.?0+$/, '');
  return text || '0';
}

function floorText(value: number, places: number): string {
  const factor = 10 ** places;
  const floored = Math.floor(value * factor + 1e-9) / factor;
  return String(floored);
}

function parseAmount(text: string): number | null {
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function typedPrice(text: string, places: number): number | null {
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Number(value.toFixed(places));
  return rounded > 0 ? rounded : null;
}

/** Base size of a limit order. A sell pays the base. A buy pays the quote. */
function limitBase(payAmount: number, price: number, side: 'buy' | 'sell', places: number): number {
  if (side === 'sell') return Number(floorText(payAmount, places));
  if (!(price > 0)) return 0;
  return Number(floorText(payAmount / price, places));
}

function orderLeft(order: SafeOrder): number {
  const left = order.origin - order.filled;
  return left > 0 ? left : order.origin;
}

function rowOf(rows: SpotBalance[], asset: string): SpotBalance {
  return rows.find((item) => item.asset === asset) ?? { asset, available: 0, locked: 0 };
}

function freeMessage(asset: string, free: number, locked: number): string {
  const lockedPart = locked > 0 ? `; ${formatBalance(locked)} locked in open orders` : '';
  return `Only ${formatBalance(free)} ${asset} free${lockedPart}.`;
}

function formatBook(value: number, places: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(Math.min(8, Math.max(places, 0)));
  const [whole, frac = ''] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

function formatChange(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  if (text.includes('%')) return text;
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  return `${n > 0 ? '+' : ''}${text}%`;
}

function slippageVersus(fill: BookFill): string {
  return fill.referenceIsLast ? 'the last price' : 'the top of the book';
}

function slippagePercent(fill: BookFill): string {
  const pct = (Math.abs(fill.slippageBps) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (fill.slippageBps > 0) return `${pct}% worse than ${slippageVersus(fill)}`;
  if (fill.slippageBps < 0) return `${pct}% better than ${slippageVersus(fill)}`;
  return `0% vs ${slippageVersus(fill)}`;
}

function slippageAmountText(fill: BookFill, quote: string, places: number): string {
  const amount = `${formatBook(Math.abs(fill.slippageQuote), places)} ${quote}`;
  if (Math.abs(fill.slippageQuote) < 1e-12) return `0 ${quote}`;
  return fill.slippageQuote > 0 ? `${amount} worse than ${slippageVersus(fill)}` : `${amount} better than ${slippageVersus(fill)}`;
}

function coverageText(
  fill: BookFill,
  base: string,
  quote: string,
  amountPlaces: number,
  totalPlaces: number,
): string {
  const sized = `${floorText(fill.base, amountPlaces)} ${base} (${floorText(fill.quote, totalPlaces)} ${quote})`;
  if (fill.complete) return `Covers this order · ${sized}`;
  if (fill.shortBook) return `The loaded book ends before this order is covered. Priced ${sized}. The rest can fill at any price.`;
  return `The book covers ${sized}. The rest may not fill.`;
}

function liveOf(route: SafeRoute, limits: Record<string, SafeNetworkLimits>): SafeNetworkLimits {
  return limits[route.id] ?? {
    minDeposit: route.minDeposit,
    minWithdraw: route.minWithdraw,
    fee: route.fee,
    confirmations: route.confirmations,
    depositEnabled: true,
    withdrawEnabled: true,
  };
}

function depositFeeLabel(route: SafeRoute): string {
  if (route.chain === 'wart') return `about ${DEFAULT_FEE} WART`;
  if (route.chain === 'bitcoin') return 'Bitcoin miner fee';
  if (route.chain === 'ethereum') return 'ETH for gas';
  return 'SOL for the network fee';
}

interface Props {
  rows: SpotBalance[] | null;
  onRows: (rows: SpotBalance[]) => void;
  lastPrice: string;
  wartAddress: string;
  ethAddress: string;
  btcAddress: string;
  solAddress: string;
  node: string;
  nextNonce: number;
  walletWartFree: string;
  walletWartLocked: string;
  onWartSent: (nextNonce: number) => void;
}

const SafeTradeCard: React.FC<Props> = ({
  rows,
  onRows,
  lastPrice,
  wartAddress,
  ethAddress,
  btcAddress,
  solAddress,
  node,
  nextNonce,
  walletWartFree,
  walletWartLocked,
  onWartSent,
}) => {
  const [panel, setPanel] = useState<Panel>('swap');
  const [network, setNetwork] = useState('Ethereum');
  const [payPick, setPayPick] = useState('ethereum:usdt');
  const [receivePick, setReceivePick] = useState('wart:wart');
  const [movePick, setMovePick] = useState('ethereum:usdt');
  const [moveDir, setMoveDir] = useState<MoveDir>('deposit');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [openOrders, setOpenOrders] = useState<SafeOrder[]>([]);
  const [ordersError, setOrdersError] = useState('');
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SafeOrder | null>(null);
  const [slippageBps, setSlippageBps] = useState<number | null>(100);
  const [depth, setDepth] = useState<SafeDepth | null>(null);
  const [depthError, setDepthError] = useState('');
  const [depthBusy, setDepthBusy] = useState(false);
  const [reviewFill, setReviewFill] = useState<BookFill | null>(null);
  const depthRef = useRef<SafeDepth | null>(null);
  const depthMarket = useRef('');
  const [emailCode, setEmailCode] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const flow = useSpendFlow();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [limits, setLimits] = useState<Record<string, SafeNetworkLimits>>({});
  const [deposits, setDeposits] = useState<Record<string, string>>({});
  const [depositError, setDepositError] = useState('');
  const [books, setBooks] = useState<Record<string, Book>>({});
  const cardRef = useRef<View>(null);
  const [quote, setQuote] = useState<SafeTicker | null>(
    lastPrice ? { market: 'WART/USDT', last: lastPrice, change: '' } : null,
  );
  const [walletEth, setWalletEth] = useState<string | null>(null);
  const [walletUsdt, setWalletUsdt] = useState<string | null>(null);
  const [walletBtc, setWalletBtc] = useState<string | null>(null);
  const [walletBtcMax, setWalletBtcMax] = useState('');
  const [walletSol, setWalletSol] = useState<string | null>(null);
  const [walletSolMax, setWalletSolMax] = useState('');
  const [walletSpl, setWalletSpl] = useState<Record<string, { text: string | null; failed: boolean }>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const checked = rows != null;
  const coinChoices = coinsOn(network);
  const payCurrent = choiceById(payPick);
  const pay = coinChoices.find((row) => row.id === payPick)
    ?? coinChoices.find((row) => row.currency === payCurrent.currency)
    ?? payCurrent;
  const receiveRows = marketPartners(pay.currency, network);
  const receiveWanted = choiceById(receivePick);
  const receive = receiveRows.find((row) => row.currency === receiveWanted.currency)
    ?? receiveRows[0]
    ?? receiveWanted;
  const moveCurrent = choiceById(movePick);
  const moveChoice = coinChoices.find((row) => row.id === movePick)
    ?? coinChoices.find((row) => row.currency === moveCurrent.currency)
    ?? coinChoices[0]
    ?? SWAP_CHOICES[0];
  const route = SAFE_ROUTES.find((item) => item.currency === moveChoice.currency && item.network === network) ?? SAFE_ROUTES[0];
  const pair = panel === 'move' ? null : safePair(pay.currency, receive.currency);
  const limitPx = pair ? typedPrice(limitPrice, pair.market.pricePlaces) : null;
  const pairName = pair ? `${pair.market.base.toUpperCase()}/${pair.market.quote.toUpperCase()}` : '';
  const price = quote && quote.market === pairName ? Number(quote.last) : 0;
  const payValue = parseAmount(amount);
  const slippageLabel = slippageBps == null
    ? 'Off'
    : (SLIPPAGE.find((choice) => choice.bps === slippageBps)?.label ?? `${slippageBps / 100}%`);
  const worstPrice = pair && price > 0 && slippageBps != null
    ? safeSlippagePrice(price, pair.side, slippageBps, pair.market.pricePlaces)
    : null;
  const bookFill = panel === 'swap' && slippageBps == null && pair && payValue != null && depth
    ? walkBook(depth, pair.side, payValue, price)
    : null;
  const atLeast = payValue != null && worstPrice != null && pair
    ? formatBalance(pair.side === 'sell' ? payValue * worstPrice : payValue / worstPrice)
    : '';
  const live = liveOf(route, limits);
  const paySymbol = panel === 'move' ? route.symbol : pay.symbol;

  const clearEntry = () => {
    setAmount('');
    setEmailCode('');
    setOtpCode('');
    setNotice('');
    setError('');
  };

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const next: Record<string, SafeNetworkLimits> = {};
      await Promise.all(SAFE_ROUTES.map(async (item) => {
        const row = await safePublicNetwork(item.currency, item.blockchainKey);
        if (row) next[item.id] = row;
      }));
      if (!cancel) setLimits(next);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const marketId = pair?.market.id ?? '';
  const seenMarket = useRef(marketId);
  useEffect(() => {
    if (!marketId || seenMarket.current === marketId) return;
    seenMarket.current = marketId;
    setLimitPrice('');
  }, [marketId]);

  useEffect(() => {
    if (panel === 'move' || !pair) return undefined;
    let cancel = false;
    if (pair.market.id !== 'wartusdt') setQuote(null);
    void safeTicker(pair.market.id).then((next) => {
      if (cancel) return;
      setQuote(next);
      const rounded = typedPrice(next.last, pair.market.pricePlaces);
      setLimitPrice((prev) => prev || (rounded != null ? String(rounded) : next.last));
    }).catch(() => {
      if (!cancel && pair.market.id !== 'wartusdt') setQuote(null);
    });
    return () => {
      cancel = true;
    };
  }, [panel, pair?.market.id]);

  useEffect(() => {
    if (panel === 'move' || !marketId) {
      depthMarket.current = '';
      depthRef.current = null;
      setDepth(null);
      setDepthError('');
      setDepthBusy(false);
      return undefined;
    }
    let cancel = false;
    const keep = depthMarket.current === marketId && depthRef.current != null;
    depthMarket.current = marketId;
    if (!keep) {
      depthRef.current = null;
      setDepth(null);
      setDepthError('');
    }
    const load = async () => {
      setDepthBusy(true);
      try {
        const next = await safeDepth(marketId);
        if (cancel || depthMarket.current !== marketId) return;
        depthRef.current = next;
        setDepth(next);
        setDepthError('');
      } catch (err) {
        if (cancel || depthMarket.current !== marketId) return;
        if (!depthRef.current) setDepthError(explainExchangeFailure(err));
      } finally {
        if (!cancel && depthMarket.current === marketId) setDepthBusy(false);
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 8000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [panel, marketId]);

  const loadOrders = async (id: string) => {
    setOrdersBusy(true);
    try {
      const creds = await loadSafeTradeCredentials();
      if (!creds) {
        setOpenOrders([]);
        setOrdersError('Check balances first.');
        return;
      }
      const list = await safeOpenOrders(creds, id);
      setOpenOrders(list);
      setOrdersError('');
    } catch (err) {
      setOrdersError(explainExchangeFailure(err));
    } finally {
      setOrdersBusy(false);
    }
  };

  useEffect(() => {
    if (panel !== 'limit' || !marketId || !rows) return undefined;
    let cancel = false;
    void (async () => {
      setOrdersBusy(true);
      try {
        const creds = await loadSafeTradeCredentials();
        if (cancel) return;
        if (!creds) {
          setOpenOrders([]);
          setOrdersError('Check balances first.');
          return;
        }
        const list = await safeOpenOrders(creds, marketId);
        if (!cancel) {
          setOpenOrders(list);
          setOrdersError('');
        }
      } catch (err) {
        if (!cancel) setOrdersError(explainExchangeFailure(err));
      } finally {
        if (!cancel) setOrdersBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [panel, marketId, rows]);

  const loadWallet = async () => {
    const nextFailed: Record<string, boolean> = {};
    if (ethAddress) {
      try {
        const holdings = await readEthereumHoldings(ethAddress);
        setWalletEth(holdings.find((row) => row.symbol === 'ETH')?.amount ?? null);
        setWalletUsdt(holdings.find((row) => row.symbol === 'USDT')?.amount ?? null);
        if (holdings.find((row) => row.symbol === 'ETH')?.amount == null) nextFailed.eth = true;
        if (holdings.find((row) => row.symbol === 'USDT')?.amount == null) nextFailed.usdt = true;
      } catch {
        setWalletEth(null);
        setWalletUsdt(null);
        nextFailed.eth = true;
        nextFailed.usdt = true;
      }
    } else {
      setWalletEth(null);
      setWalletUsdt(null);
    }
    if (btcAddress) {
      try {
        const [balance, max] = await Promise.all([
          fetchBtcBalance(btcAddress),
          maxSendableBtc(btcAddress),
        ]);
        setWalletBtc(formatBtc(balance));
        setWalletBtcMax(max > 0n ? formatBtc(max) : '');
      } catch {
        setWalletBtc(null);
        setWalletBtcMax('');
        nextFailed.btc = true;
      }
    } else {
      setWalletBtc(null);
      setWalletBtcMax('');
    }
    const nextSpl: Record<string, { text: string | null; failed: boolean }> = {};
    if (solAddress) {
      try {
        const [balance, max] = await Promise.all([
          fetchSolBalance(solAddress),
          maxSolPayment(solAddress),
        ]);
        setWalletSol(formatSol(balance));
        setWalletSolMax(max > 0n ? formatSol(max) : '');
      } catch {
        setWalletSol(null);
        setWalletSolMax('');
        nextFailed.sol = true;
      }
      await Promise.all([
        ['usdc', USDC_MINT],
        ['usdt', USDT_MINT],
      ].map(async ([currency, mint]) => {
        const key = `solana:${currency}`;
        try {
          const raw = await readOneBalance('solana', solAddress, { native: false, address: mint });
          nextSpl[key] = { text: formatUnits(raw, 6), failed: false };
        } catch {
          nextSpl[key] = { text: null, failed: true };
        }
      }));
    } else {
      setWalletSol(null);
      setWalletSolMax('');
    }
    setWalletSpl(nextSpl);
    setFailed(nextFailed);
  };

  useEffect(() => {
    void loadWallet();
  }, [ethAddress, btcAddress, solAddress]);

  const destination = addressFor(route, { wartAddress, ethAddress, btcAddress, solAddress });

  useEffect(() => {
    if (!checked || panel !== 'move' || moveDir !== 'deposit') return undefined;
    if (deposits[route.id]) return undefined;
    let cancel = false;
    void (async () => {
      const creds = await loadSafeTradeCredentials();
      if (cancel) return;
      if (!creds) {
        setDepositError('Save a SafeTrade API key and secret first.');
        return;
      }
      try {
        const address = await safeDepositAddress(creds, route.currency, route.blockchainKey);
        if (!cancel) {
          setDeposits((prev) => ({ ...prev, [route.id]: address }));
          setDepositError('');
        }
      } catch (err) {
        if (!cancel) setDepositError(explainExchangeFailure(err));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [checked, panel, moveDir, route.id, route.currency, route.blockchainKey, deposits]);

  const refreshBook = async (item: SafeRoute, address: string) => {
    if (!address) {
      setBooks((prev) => ({ ...prev, [item.id]: null }));
      return;
    }
    const creds = await loadSafeTradeCredentials();
    if (!creds) return;
    try {
      const next = await safeCoinAddressBook(creds, {
        currency: item.currency,
        blockchainKey: item.blockchainKey,
        min: liveOf(item, limits).minWithdraw,
        fee: liveOf(item, limits).fee,
        decimals: item.decimals,
        bookLabel: 'This wallet',
      }, address);
      setBooks((prev) => ({ ...prev, [item.id]: next }));
    } catch {
      setBooks((prev) => ({ ...prev, [item.id]: 'error' }));
    }
  };

  useEffect(() => {
    if (!checked || panel !== 'move' || moveDir !== 'withdraw') return undefined;
    let cancel = false;
    void (async () => {
      await refreshBook(route, destination);
      if (cancel) return;
    })();
    return () => {
      cancel = true;
    };
  }, [checked, panel, moveDir, route.id, destination]);

  const walletSide = useMemo(() => {
    if (route.currency === 'wart') {
      return { text: walletWartFree || '…', max: walletMaxWart(walletWartFree), pending: false, failed: false, locked: Number(walletWartLocked) > 0 ? walletWartLocked : '' };
    }
    if (route.currency === 'eth') {
      return { text: walletEth == null ? (failed.eth ? '—' : '…') : walletEth, max: walletEth && Number(walletEth) > 0 ? floorText(Number(walletEth), route.decimals) : '', pending: walletEth == null && !failed.eth && Boolean(ethAddress), failed: Boolean(failed.eth), locked: '' };
    }
    if (route.currency === 'usdt' && route.chain === 'ethereum') {
      return { text: walletUsdt == null ? (failed.usdt ? '—' : '…') : walletUsdt, max: walletUsdt && Number(walletUsdt) > 0 ? floorText(Number(walletUsdt), route.decimals) : '', pending: walletUsdt == null && !failed.usdt && Boolean(ethAddress), failed: Boolean(failed.usdt), locked: '' };
    }
    if (route.currency === 'btc') {
      return { text: walletBtc == null ? (failed.btc ? '—' : '…') : walletBtc, max: walletBtcMax, pending: walletBtc == null && !failed.btc && Boolean(btcAddress), failed: Boolean(failed.btc), locked: '' };
    }
    if (route.currency === 'sol' && route.chain === 'solana') {
      return { text: walletSol == null ? (failed.sol ? '—' : '…') : walletSol, max: walletSolMax, pending: walletSol == null && !failed.sol && Boolean(solAddress), failed: Boolean(failed.sol), locked: '' };
    }
    if ((route.currency === 'usdc' || route.currency === 'usdt') && route.chain === 'solana') {
      if (!solAddress) return { text: '—', max: '', pending: false, failed: false, locked: '' };
      const row = walletSpl[`solana:${route.currency}`];
      if (!row) return { text: '…', max: '', pending: true, failed: false, locked: '' };
      const text = row.text == null ? '—' : row.text;
      const max = row.text && Number(row.text) > 0 ? floorText(Number(row.text), route.decimals) : '';
      return { text, max, pending: false, failed: row.failed, locked: '' };
    }
    return { text: '—', max: '', pending: false, failed: false, locked: '' };
  }, [
    route, walletWartFree, walletWartLocked, walletEth, walletUsdt, walletBtc, walletBtcMax,
    walletSol, walletSolMax, walletSpl, failed,
    ethAddress, btcAddress, solAddress,
  ]);

  const exchangeRow = rowOf(rows ?? [], paySymbol);
  const receiveText = useMemo(() => {
    if (payValue == null) return '0';
    if (panel === 'swap') {
      if (!pair) return '0';
      const basePlaces = pair.market.amountPlaces;
      const quotePlaces = pair.market.totalPlaces;
      if (bookFill) {
        return pair.side === 'sell' ? floorText(bookFill.quote, quotePlaces) : floorText(bookFill.base, basePlaces);
      }
      if (!(price > 0)) return '0';
      return pair.side === 'sell' ? floorText(payValue * price, quotePlaces) : floorText(payValue / price, basePlaces);
    }
    if (panel === 'limit') {
      if (!pair || limitPx == null) return '0';
      if (pair.side === 'sell') return formatBalance(payValue * limitPx);
      return formatBalance(limitBase(payValue, limitPx, 'buy', pair.market.amountPlaces));
    }
    if (moveDir === 'withdraw') return formatBalance(Math.max(0, payValue - live.fee));
    return formatBalance(payValue);
  }, [payValue, panel, price, pair, bookFill, limitPx, moveDir, live.fee]);

  const maxAmount = (): string => {
    if (!rows) return '';
    if (panel === 'swap' || panel === 'limit') {
      if (!pair) return '';
      const places = pair.side === 'sell' ? pair.market.amountPlaces : pair.market.totalPlaces;
      const text = floorText(exchangeRow.available, places);
      return exchangeRow.available > 0 && text !== '0' ? text : '';
    }
    if (moveDir === 'deposit') return walletSide.max;
    const places = route.decimals;
    const text = formatBalance(exchangeRow.available);
    return exchangeRow.available >= live.minWithdraw && floorText(exchangeRow.available, places) !== '0' ? text : '';
  };

  const problem = useMemo(() => {
    if (!rows || payValue == null) return '';
    if (panel === 'swap' || panel === 'limit') {
      if (!pair) return `SafeTrade has no ${pay.symbol}/${receive.symbol} market.`;
      if (panel === 'limit') {
        if (limitPx == null) return 'Enter a limit price.';
        const baseSize = limitBase(payValue, limitPx, pair.side, pair.market.amountPlaces);
        const base = pair.market.base.toUpperCase();
        if (!(baseSize > 0) || baseSize < pair.market.minBase) {
          return `Minimum ${pair.side === 'buy' ? 'buy' : 'sell'} is ${pair.market.minBase} ${base}.`;
        }
        const spend = pair.side === 'sell' ? baseSize : baseSize * limitPx;
        if (payValue > exchangeRow.available + 1e-9 || spend > exchangeRow.available + 1e-8) {
          return freeMessage(pay.symbol, exchangeRow.available, exchangeRow.locked);
        }
        return '';
      }
      if (slippageBps != null && price > 0 && worstPrice == null) return 'That slippage does not leave a usable price on this market.';
      if (slippageBps == null && depthError && !depth) return depthError;
      if (slippageBps == null && depth && payValue != null && !bookFill) {
        const baseName = pair.market.base.toUpperCase();
        return pair.side === 'buy'
          ? `Nobody is selling ${baseName} on this book.`
          : `Nobody is buying ${baseName} on this book.`;
      }
      const base = pair.market.base.toUpperCase();
      if (pair.side === 'sell' && payValue < pair.market.minBase) {
        return `Minimum ${base} sell is ${pair.market.minBase}.`;
      }
      const buySize = pair.side === 'buy'
        ? (bookFill ? bookFill.base : (price > 0 ? payValue / price : null))
        : null;
      if (buySize != null && buySize < pair.market.minBase) {
        return `Minimum buy is ${pair.market.minBase} ${base}.`;
      }
      if (payValue > exchangeRow.available + 1e-9) {
        return freeMessage(pay.symbol, exchangeRow.available, exchangeRow.locked);
      }
      return '';
    }
    if (moveDir === 'deposit') {
      if (!route.canDeposit) return `This wallet cannot send ${route.symbol} on ${route.network} yet.`;
      if (!live.depositEnabled) return `SafeTrade has ${route.symbol} deposits on ${route.network} turned off.`;
      if (!destination) return `This wallet has no ${route.network} address.`;
      if (route.chain === 'wart' && (!wartAddress || !node)) return 'Open a wallet on Warthog mainnet first.';
      if (route.chain === 'wart' && isDefiNode(node)) return 'Switch this wallet to Warthog mainnet before sending WART to SafeTrade.';
      if (payValue < live.minDeposit) return `Minimum ${route.symbol} deposit on ${route.network} is ${live.minDeposit}.`;
      if (route.currency === 'wart') {
        const free = Number(walletWartFree);
        const fee = Number(DEFAULT_FEE);
        if (Number.isFinite(free) && payValue + fee > free + 1e-8) {
          return `Only ${walletWartFree} WART is free. This send also needs a ${DEFAULT_FEE} WART fee.`;
        }
        return '';
      }
      if (walletSide.pending) return '';
      if (walletSide.failed) return `${route.network} ${route.symbol} balance unavailable.`;
      if (walletSide.text !== '…' && walletSide.text !== '—' && Number(floorText(payValue, route.decimals)) > Number(walletSide.text) + 1e-9) {
        return `Only ${walletSide.text} ${route.symbol} is in this wallet.`;
      }
      return '';
    }
    if (!live.withdrawEnabled) return `SafeTrade has ${route.symbol} withdrawals on ${route.network} turned off.`;
    if (!destination) return `This wallet has no ${route.network} address.`;
    if (payValue < live.minWithdraw) return `Minimum ${route.symbol} withdraw is ${live.minWithdraw}. Fee is ${live.fee}.`;
    if (payValue > exchangeRow.available + 1e-9) return freeMessage(route.symbol, exchangeRow.available, exchangeRow.locked);
    return '';
  }, [
    rows, payValue, panel, pair, pay.symbol, receive.symbol, price, limitPx, worstPrice, slippageBps,
    depth, depthError, bookFill, exchangeRow, moveDir, route,
    live, destination, wartAddress, node, walletWartFree, walletSide,
  ]);

  const available = panel !== 'move' || moveDir === 'withdraw'
    ? {
        text: rows ? formatBalance(exchangeRow.available) : '…',
        unit: paySymbol,
        where: 'on SafeTrade',
        locked: rows && exchangeRow.locked > 0 ? formatBalance(exchangeRow.locked) : '',
      }
    : {
        text: walletSide.text,
        unit: route.symbol,
        where: 'in this wallet',
        locked: walletSide.locked,
      };

  const chooseNetwork = (nextNetwork: string) => {
    const coins = coinsOn(nextNetwork);
    const fallback = coins[0];
    if (!fallback) return;
    setNetwork(nextNetwork);
    const moveNext = coins.find((row) => row.currency === moveChoice.currency) ?? fallback;
    setMovePick(moveNext.id);
    const payNext = coins.find((row) => row.currency === pay.currency) ?? fallback;
    setPayPick(payNext.id);
    const stillPairs = receive.currency !== payNext.currency && Boolean(safePair(payNext.currency, receive.currency));
    if (stillPairs) {
      const picked = choiceForCurrency(receive.currency, nextNetwork);
      if (picked) setReceivePick(picked.id);
    } else {
      const partner = marketPartners(payNext.currency, nextNetwork)[0];
      if (partner) setReceivePick(partner.id);
    }
    clearEntry();
  };

  const chooseSwap = (side: 'pay' | 'receive', id: string) => {
    const next = choiceById(id);
    const other = side === 'pay' ? receive : pay;
    if (next.currency === other.currency) {
      const nextPay = side === 'pay' ? next : receive;
      const nextReceive = side === 'pay' ? pay : next;
      setPayPick(nextPay.id);
      setReceivePick(nextReceive.id);
      if (nextPay.network !== network) setNetwork(nextPay.network);
    } else if (side === 'pay') {
      setPayPick(next.id);
      if (!safePair(next.currency, receive.currency)) {
        const partner = marketPartners(next.currency, next.network)[0];
        if (partner) setReceivePick(partner.id);
      }
    } else if (safePair(pay.currency, next.currency)) {
      setReceivePick(next.id);
    }
    clearEntry();
  };

  const chooseMove = (id: string) => {
    setMovePick(id);
    clearEntry();
  };

  const flip = () => {
    if (panel !== 'move') {
      const nextPay = receive;
      const nextReceive = pay;
      setPayPick(nextPay.id);
      setReceivePick(nextReceive.id);
      if (nextPay.network !== network) setNetwork(nextPay.network);
    } else {
      setMoveDir((dir) => (dir === 'deposit' ? 'withdraw' : 'deposit'));
    }
    clearEntry();
  };

  const switchPanel = (next: Panel) => {
    setPanel(next);
    clearEntry();
  };

  const openMove = (dir: MoveDir) => {
    if (panel === 'move' && moveDir === dir) return;
    setPanel('move');
    setMoveDir(dir);
    clearEntry();
  };

  const refreshExchange = async () => {
    const creds = await loadSafeTradeCredentials();
    if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
    const next = await safeBalances(creds);
    onRows(next);
    return { creds, rows: next };
  };

  const submit = async () => {
    setNotice('');
    setError('');
    const value = parseAmount(amount);
    if (value == null) {
      setError('Enter an amount.');
      setReviewOpen(false);
      return;
    }
    if (problem) {
      setError(problem);
      setReviewOpen(false);
      return;
    }
    const action = panel === 'swap'
      ? `Placing ${pay.symbol} for ${receive.symbol} on SafeTrade…`
      : panel === 'limit'
        ? `Placing the ${pay.symbol} limit on SafeTrade…`
      : moveDir === 'deposit'
        ? `Sending ${amount.trim()} ${route.symbol} to SafeTrade…`
        : `Withdrawing ${amount.trim()} ${route.symbol}…`;
    flow.begin(action);
    setBusy(true);
    try {
      if (panel === 'limit') {
        if (!pair) throw new Error(`SafeTrade has no ${pay.symbol}/${receive.symbol} market.`);
        if (limitPx == null) throw new Error('Enter a limit price.');
        const { creds, rows: liveRows } = await refreshExchange();
        const free = rowOf(liveRows, pay.symbol);
        const places = pair.side === 'sell' ? pair.market.amountPlaces : pair.market.totalPlaces;
        if (value > free.available + 1e-9) {
          setAmount(free.available > 0 ? floorText(free.available, places) : '');
          const msg = freeMessage(pay.symbol, free.available, free.locked);
          setError(msg);
          flow.finish(false, 'Insufficient free balance', msg);
          return;
        }
        const baseSize = limitBase(value, limitPx, pair.side, pair.market.amountPlaces);
        const baseUnit = pair.market.base.toUpperCase();
        if (!(baseSize > 0) || baseSize < pair.market.minBase) {
          throw new Error(`Minimum order is ${pair.market.minBase} ${baseUnit}.`);
        }
        const spend = pair.side === 'sell' ? baseSize : baseSize * limitPx;
        if (spend > free.available + 1e-8) {
          const msg = freeMessage(pay.symbol, free.available, free.locked);
          setError(msg);
          flow.finish(false, 'Insufficient free balance', msg);
          return;
        }
        flow.setStep('Placing the limit order…');
        await safeLimitOrder(creds, {
          market: pair.market,
          side: pair.side,
          amount: baseSize,
          price: limitPx,
        });
        await refreshExchange();
        const quoteUnit = pair.market.quote.toUpperCase();
        const doneText = `${pair.side === 'buy' ? 'Buy' : 'Sell'} limit for ${formatBalance(baseSize)} ${baseUnit} at ${limitPx} ${quoteUnit} is open.`;
        setNotice(doneText);
        flow.finish(true, 'Limit placed', doneText);
        return;
      }
      if (panel === 'swap') {
        if (!pair) throw new Error(`SafeTrade has no ${pay.symbol}/${receive.symbol} market.`);
        const { creds, rows: liveRows } = await refreshExchange();
        const free = rowOf(liveRows, pay.symbol);
        const places = pair.side === 'sell' ? pair.market.amountPlaces : pair.market.totalPlaces;
        if (value > free.available + 1e-9) {
          setAmount(free.available > 0 ? floorText(free.available, places) : '');
          const msg = freeMessage(pay.symbol, free.available, free.locked);
          setError(msg);
          flow.finish(false, 'Insufficient free balance', msg);
          return;
        }
        flow.setStep('Waiting for SafeTrade to fill the order…');
        const placed = await safeSwap(creds, {
          market: pair.market,
          side: pair.side,
          amount: value,
          slippageBps,
        });
        const finished = placed.id ? await safeWaitOrder(creds, placed.id) : placed;
        await refreshExchange();
        const base = pair.market.base.toUpperCase();
        const quoteUnit = pair.market.quote.toUpperCase();
        let doneText = '';
        if (finished.filled > 0) {
          if (pair.side === 'buy') {
            const spent = finished.averagePrice > 0
              ? formatBalance(finished.filled * finished.averagePrice)
              : formatBalance(value);
            doneText = `Sold ${spent} ${quoteUnit} for ${formatBalance(finished.filled)} ${base}.`;
          } else {
            const got = finished.averagePrice > 0
              ? formatBalance(finished.filled * finished.averagePrice)
              : '';
            doneText = got
              ? `Sold ${formatBalance(finished.filled)} ${base} for about ${got} ${quoteUnit}.`
              : `Sold ${formatBalance(finished.filled)} ${base}.`;
          }
        } else {
          doneText = `Order ${finished.id || ''} is ${finished.state || 'open'}. Nothing filled yet.`;
        }
        setNotice(doneText);
        flow.finish(true, finished.filled > 0 ? 'Swapped' : 'Order placed', doneText);
        return;
      }
      if (moveDir === 'deposit') {
        const creds = await loadSafeTradeCredentials();
        if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
        const dest = deposits[route.id] || await safeDepositAddress(creds, route.currency, route.blockchainKey);
        setDeposits((prev) => ({ ...prev, [route.id]: dest }));
        const own = destination;
        if (sameAddress(route, dest, own)) throw new Error('That deposit address is this wallet.');
        const spend = floorText(value, route.decimals);
        const sent = await sendDeposit({
          route,
          dest,
          amount: spend,
          node,
          nextNonce,
          from: wartAddress,
          onWartSent,
          onNotice: setNotice,
        });
        await loadWallet();
        const sentText = `${sent} SafeTrade credits it after about ${live.confirmations} confirmations.`;
        setNotice(sentText);
        flow.finish(true, 'Deposit sent', sentText);
        return;
      }
      const { creds, rows: liveRows } = await refreshExchange();
      const free = rowOf(liveRows, route.symbol);
      if (value > free.available + 1e-9) {
        setAmount(free.available > 0 ? formatBalance(free.available) : '');
        const msg = freeMessage(route.symbol, free.available, free.locked);
        setError(msg);
        flow.finish(false, 'Insufficient free balance', msg);
        return;
      }
      const result = await safeWithdrawCoin(creds, {
        currency: route.currency,
        blockchainKey: route.blockchainKey,
        min: live.minWithdraw,
        fee: live.fee,
        decimals: route.decimals,
        bookLabel: 'This wallet',
      }, {
        amount: value,
        address: destination,
        emailCode,
        otpCode,
      });
      if ('needCode' in result) {
        if (result.clearEmail) setEmailCode('');
        setNotice(result.message);
        flow.finish(false, 'Code needed', result.message);
        void refreshBook(route, destination);
        return;
      }
      await refreshExchange();
      void refreshBook(route, destination);
      setEmailCode('');
      const sentText = result.txid
        ? `${route.symbol} withdraw ${result.id} ${result.status}. Tx ${result.txid}`
        : `${route.symbol} withdraw ${result.id} submitted${result.status ? ` (${result.status})` : ''}.`;
      setNotice(sentText);
      flow.finish(true, 'Withdraw submitted', sentText);
    } catch (err) {
      const message = explainExchangeFailure(err);
      setNotice('');
      setError(message);
      flow.finish(false, 'Could not finish', message);
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    const target = cancelTarget;
    if (!target) return;
    flow.begin('Canceling the order…');
    setBusy(true);
    setError('');
    try {
      const creds = await loadSafeTradeCredentials();
      if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
      await safeCancelOrder(creds, target.id);
      await refreshExchange();
      if (marketId) await loadOrders(marketId);
      const doneText = `Canceled the ${target.side || 'open'} order.`;
      setNotice(doneText);
      flow.finish(true, 'Order canceled', doneText);
    } catch (err) {
      const message = explainExchangeFailure(err);
      setNotice('');
      setError(message);
      flow.finish(false, 'Could not cancel', message);
    } finally {
      setBusy(false);
    }
  };

  const copyDeposit = (value: string) => {
    if (!value) return;
    void Clipboard.setStringAsync(value);
    setNotice('Deposit address copied.');
    setError('');
  };

  const beginReview = async () => {
    setCancelTarget(null);
    setError('');
    if (payValue == null) {
      setError('Enter an amount.');
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }
    if (panel !== 'swap' || slippageBps != null || !pair) {
      setReviewFill(null);
      setReviewOpen(true);
      return;
    }
    const id = pair.market.id;
    setBusy(true);
    try {
      const [next, tick] = await Promise.all([
        safeDepth(id),
        safeTicker(id).catch(() => null),
      ]);
      if (depthMarket.current === id) {
        depthRef.current = next;
        setDepth(next);
        setDepthError('');
      }
      if (tick) setQuote(tick);
      const ref = tick ? Number(tick.last) : price;
      const fill = walkBook(next, pair.side, payValue, Number.isFinite(ref) ? ref : 0);
      if (!fill) {
        const baseName = pair.market.base.toUpperCase();
        setError(pair.side === 'buy'
          ? `Nobody is selling ${baseName} on this book.`
          : `Nobody is buying ${baseName} on this book.`);
        return;
      }
      setReviewFill(fill);
      setReviewOpen(true);
    } catch (err) {
      setError(explainExchangeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const limitSize = pair && limitPx != null && payValue != null
    ? limitBase(payValue, limitPx, pair.side, pair.market.amountPlaces)
    : 0;
  const title = panel === 'swap'
    ? 'Swap'
    : panel === 'limit'
      ? 'Limit'
    : moveDir === 'deposit'
      ? `Deposit ${route.symbol}`
      : `Withdraw ${route.symbol}`;
  const subtitle = panel === 'swap'
    ? (pair ? `${pay.symbol} for ${receive.symbol}` : `${pay.symbol} / ${receive.symbol}`)
    : panel === 'limit'
      ? (pair
        ? `${pair.side === 'buy' ? 'Buy' : 'Sell'} ${pair.market.base.toUpperCase()} at your price`
        : `${pay.symbol} / ${receive.symbol}`)
    : moveDir === 'deposit'
      ? `${route.network} → SafeTrade`
      : `SafeTrade → ${route.network}`;
  const depositAddress = deposits[route.id] ?? '';
  const book = books[route.id] ?? null;
  const waitingBalance = panel === 'move' && moveDir === 'deposit' && walletSide.pending;
  const filledMax = maxAmount();
  const ctaDisabled = !rows || busy || payValue == null || Boolean(problem) || waitingBalance || (panel === 'limit' && limitPx == null);
  const cta = panel === 'swap'
    ? `Swap ${pay.symbol} for ${receive.symbol}`
    : panel === 'limit'
      ? `Place ${pair?.side === 'sell' ? 'sell' : 'buy'} limit`
    : moveDir === 'deposit'
      ? `Deposit ${route.symbol}`
      : `Withdraw ${route.symbol}`;
  const coinGroups = coinMenu(coinChoices, network);

  const summaryRows: { label: string; value: string }[] = [];
  if (panel === 'limit') {
    const quoteUnit = pair?.market.quote.toUpperCase() ?? '';
    const baseUnit = pair?.market.base.toUpperCase() ?? '';
    summaryRows.push({
      label: 'Limit price',
      value: limitPx != null ? `${limitPx} ${quoteUnit}` : '…',
    });
    summaryRows.push({
      label: 'Order size',
      value: limitSize > 0 ? `${formatBalance(limitSize)} ${baseUnit}` : '…',
    });
    if (pair) summaryRows.push({ label: 'Smallest order', value: `${pair.market.minBase} ${baseUnit}` });
    if (!pair) summaryRows.push({ label: 'Market', value: 'No direct market' });
  } else if (panel === 'swap') {
    const quoteUnit = pair?.market.quote.toUpperCase() ?? '';
    const pricePlaces = pair?.market.pricePlaces ?? 0;
    summaryRows.push({ label: 'Price', value: price > 0 && quote ? `${quote.last} ${quoteUnit}` : '…' });
    if (slippageBps == null) {
      summaryRows.push({ label: 'Slippage limit', value: 'Off' });
      summaryRows.push({
        label: 'Average price',
        value: bookFill ? `${bookFill.averagePrice.toFixed(pricePlaces)} ${quoteUnit}` : (depth ? '…' : 'Reading the book…'),
      });
      summaryRows.push({
        label: 'Slippage amount',
        value: bookFill ? slippageAmountText(bookFill, quoteUnit, pair?.market.totalPlaces ?? 4) : '…',
      });
    } else {
      summaryRows.push({
        label: 'Worst price',
        value: worstPrice != null ? `${worstPrice.toFixed(pricePlaces)} ${quoteUnit}` : '…',
      });
      if (atLeast && pair) {
        const unit = pair.side === 'sell' ? quoteUnit : pair.market.base.toUpperCase();
        summaryRows.push({ label: 'At worst price', value: `${atLeast} ${unit}` });
      }
    }
    if (pair) summaryRows.push({ label: 'Smallest order', value: `${pair.market.minBase} ${pair.market.base.toUpperCase()}` });
    if (!pair) summaryRows.push({ label: 'Market', value: 'No direct market' });
  } else if (moveDir === 'deposit') {
    summaryRows.push(
      { label: 'Network', value: route.network },
      { label: 'Minimum', value: `${live.minDeposit} ${route.symbol}` },
      { label: 'Network fee', value: depositFeeLabel(route) },
      { label: 'Confirms', value: `about ${live.confirmations}` },
    );
  } else {
    summaryRows.push(
      { label: 'Network', value: route.network },
      { label: 'Minimum', value: `${live.minWithdraw} ${route.symbol}` },
      { label: 'Fee', value: `${live.fee} ${route.symbol}` },
    );
  }

  const trading = panel !== 'move';
  const payMenu = (
    <PickPill
      label={trading ? pay.symbol : route.symbol}
      symbol={trading ? pay.symbol : route.symbol}
      groups={coinGroups}
      selectedId={trading ? pay.id : moveChoice.id}
      locked={coinChoices.length < 2}
      onSelect={(id) => (trading ? chooseSwap('pay', id) : chooseMove(id))}
      accessibilityLabel={trading ? `Choose ${pay.symbol}` : `Choose ${route.symbol}`}
      boundsRef={cardRef}
    />
  );
  const receiveMenu = trading ? (
    <PickPill
      label={receive.symbol}
      symbol={receive.symbol}
      groups={coinMenu(receiveRows, network)}
      selectedId={receive.id}
      locked={receiveRows.length < 2}
      onSelect={(id) => chooseSwap('receive', id)}
      accessibilityLabel={`Choose ${receive.symbol}`}
      boundsRef={cardRef}
    />
  ) : (
    <PickPill
      label={route.symbol}
      symbol={route.symbol}
      groups={coinGroups}
      selectedId={moveChoice.id}
      locked
      onSelect={() => {}}
      accessibilityLabel={route.symbol}
      boundsRef={cardRef}
    />
  );
  const networkMenu = (
    <PickPill
      label={network}
      symbol={networkSymbol(network)}
      groups={[{
        title: '',
        choices: NETWORKS.map((item) => ({ id: item.id, symbol: item.symbol, label: item.id })),
      }]}
      selectedId={network}
      onSelect={chooseNetwork}
      accessibilityLabel="Choose network"
      boundsRef={cardRef}
    />
  );

  return (
    <View ref={cardRef} collapsable={false} style={styles.swapCard}>
      <View style={styles.cardHeader}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>{title}</Text>
            <NetworkModeBadge mainnet={network !== 'Warthog' || !isDefiNode(node)} />
          </View>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
        <View style={styles.headerMark}>
          {panel !== 'move' ? (
            <View style={styles.priceBlock}>
              <Text style={styles.spotLabel}>PRICE</Text>
              <Text style={styles.spotValue}>
                {price > 0 && quote ? quote.last : '…'}
                <Text style={styles.mutedLabel}> {pair?.market.quote.toUpperCase() || 'USDT'}</Text>
              </Text>
            </View>
          ) : null}
          <Image
            source={require('../../assets/safetrade-favicon.png')}
            style={styles.brandMark}
            accessibilityLabel="SafeTrade"
          />
        </View>
      </View>

      <View style={styles.modeRow}>
        <View style={styles.modeChips}>
          <TouchableOpacity
            style={[styles.chip, panel === 'swap' && styles.chipOn]}
            onPress={() => switchPanel('swap')}
            accessibilityRole="button"
            accessibilityState={{ selected: panel === 'swap' }}
          >
            <Text style={[styles.chipText, panel === 'swap' && styles.chipTextOn]}>Swap</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, panel === 'limit' && styles.chipOn]}
            onPress={() => switchPanel('limit')}
            accessibilityRole="button"
            accessibilityState={{ selected: panel === 'limit' }}
          >
            <Text style={[styles.chipText, panel === 'limit' && styles.chipTextOn]}>Limit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, panel === 'move' && moveDir === 'deposit' && styles.chipOn]}
            onPress={() => openMove('deposit')}
            accessibilityRole="button"
            accessibilityState={{ selected: panel === 'move' && moveDir === 'deposit' }}
          >
            <Text style={[styles.chipText, panel === 'move' && moveDir === 'deposit' && styles.chipTextOn]}>Deposit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, panel === 'move' && moveDir === 'withdraw' && styles.chipOn]}
            onPress={() => openMove('withdraw')}
            accessibilityRole="button"
            accessibilityState={{ selected: panel === 'move' && moveDir === 'withdraw' }}
          >
            <Text style={[styles.chipText, panel === 'move' && moveDir === 'withdraw' && styles.chipTextOn]}>Withdraw</Text>
          </TouchableOpacity>
        </View>
        {networkMenu}
      </View>

      {panel === 'limit' ? (
        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.mutedLabel}>Limit price</Text>
            <TouchableOpacity
              onPress={() => {
                if (!quote?.last || !pair) return;
                const rounded = typedPrice(quote.last, pair.market.pricePlaces);
                setLimitPrice(rounded != null ? String(rounded) : quote.last);
              }}
              disabled={!quote?.last || busy}
            >
              <Text style={styles.balanceHint}>
                Last {price > 0 && quote ? quote.last : '…'} {pair?.market.quote.toUpperCase() || ''}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              value={limitPrice}
              onChangeText={(text) => {
                setLimitPrice(text.replace(/[^0-9.]/g, ''));
                setError('');
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#3f3f46"
              editable={!busy && !!rows}
            />
            <View style={styles.tokenPill}>
              <Text style={styles.tokenPillText}>{pair?.market.quote.toUpperCase() || '—'}</Text>
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <Text style={styles.mutedLabel}>You pay</Text>
          <TouchableOpacity onPress={() => filledMax && setAmount(filledMax)} disabled={!filledMax || busy}>
            <Text style={styles.balanceHint}>
              Available {available.text} {available.unit} {available.where}
            </Text>
            {available.locked ? <Text style={styles.lockedHint}>Locked {available.locked}</Text> : null}
          </TouchableOpacity>
        </View>
        <View style={styles.amountRow}>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={(text) => {
              setAmount(text.replace(/[^0-9.]/g, ''));
              setError('');
            }}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="#3f3f46"
            editable={!busy && !!rows}
          />
          <TouchableOpacity
            style={[styles.chip, !filledMax && styles.chipOff]}
            onPress={() => filledMax && setAmount(filledMax)}
            disabled={!filledMax || busy}
          >
            <Text style={styles.chipText}>MAX</Text>
          </TouchableOpacity>
          {payMenu}
        </View>
      </View>

      <View style={styles.flipWrap}>
        <TouchableOpacity style={styles.flipBtn} onPress={flip} accessibilityLabel="Reverse direction">
          <Text style={styles.flipMark}>⇅</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <Text style={styles.mutedLabel}>You receive</Text>
          <Text style={styles.balanceHint}>
            {panel === 'swap'
              ? (slippageBps == null
                ? 'Estimate · from the order book, before the fee'
                : 'Estimate · at the last price, before the fee')
              : panel === 'limit'
                ? 'If the limit fills, before the fee'
              : moveDir === 'deposit'
                ? 'On SafeTrade'
                : `In this wallet · ${route.network} · after the fee`}
          </Text>
        </View>
        <View style={styles.amountRow}>
          <Text style={styles.amountInput}>{receiveText}</Text>
          {receiveMenu}
        </View>
      </View>

      <View style={styles.summary}>
        {summaryRows.map((row) => (
          <View key={row.label} style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>{row.label}</Text>
            <Text style={styles.summaryValue}>{row.value}</Text>
          </View>
        ))}
        {panel === 'limit' ? (
          <Text style={styles.mutedLabel}>
            The order rests on SafeTrade until it fills or you cancel it. The coins stay there until you withdraw.
          </Text>
        ) : null}
        {panel === 'swap' ? (
          <>
            <Text style={styles.mutedLabel}>Slippage limit</Text>
            <View style={styles.chipRow}>
              {SLIPPAGE.map((choice) => (
                <TouchableOpacity
                  key={choice.label}
                  style={[styles.chip, slippageBps === choice.bps && styles.chipOn]}
                  onPress={() => setSlippageBps(choice.bps)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: slippageBps === choice.bps }}
                >
                  <Text style={[styles.chipText, slippageBps === choice.bps && styles.chipTextOn]}>
                    {choice.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.mutedLabel}>
              {slippageBps == null
                ? 'No price cap. Review shows the average price and the slippage amount from the book before the order is sent.'
                : 'SafeTrade stops the order at the worst price. It stays on SafeTrade until you withdraw.'}
            </Text>
            {bookFill && !bookFill.complete ? (
              <Text style={styles.warn}>
                {coverageText(
                  bookFill,
                  pair?.market.base.toUpperCase() ?? '',
                  pair?.market.quote.toUpperCase() ?? '',
                  pair?.market.amountPlaces ?? 4,
                  pair?.market.totalPlaces ?? 4,
                )}
              </Text>
            ) : null}
          </>
        ) : null}
        {panel === 'move' && moveDir === 'deposit' ? (
          depositAddress ? (
            <TouchableOpacity onPress={() => copyDeposit(depositAddress)}>
              <Text style={styles.summaryValue}>{depositAddress}</Text>
              <Text style={styles.copyLink}>Copy SafeTrade deposit address</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.mutedLabel}>
              {rows ? (depositError || 'Loading the SafeTrade deposit address…') : 'Check balances first.'}
            </Text>
          )
        ) : null}
        {panel === 'move' && moveDir === 'withdraw' ? (
          <>
            <Text style={styles.summaryValue}>{destination || `This wallet has no ${route.network} address.`}</Text>
            <Text style={styles.bookLine}>{bookLine(book, route.symbol, rows, destination)}</Text>
          </>
        ) : null}
      </View>

      {panel !== 'move' && pair ? (
        <OrderBook
          market={pair.market}
          depth={depth}
          error={depthError}
          busy={depthBusy && !depth}
          last={price > 0 && quote?.market === pairName ? quote.last : ''}
          change={quote?.market === pairName ? quote.change : ''}
          touched={panel === 'swap' ? bookFill?.touched ?? 0 : 0}
          touchSide={pair.side}
          onPickPrice={panel === 'limit' ? (px) => {
            setLimitPrice(px);
            setError('');
          } : undefined}
          onRefresh={() => {
            if (!marketId || depthBusy) return;
            depthMarket.current = marketId;
            setDepthBusy(true);
            void safeDepth(marketId).then((next) => {
              if (depthMarket.current !== marketId) return;
              depthRef.current = next;
              setDepth(next);
              setDepthError('');
            }).catch((err) => {
              if (depthMarket.current !== marketId || depthRef.current) return;
              setDepthError(explainExchangeFailure(err));
            }).finally(() => {
              if (depthMarket.current === marketId) setDepthBusy(false);
            });
          }}
        />
      ) : null}

      {panel === 'move' && moveDir === 'withdraw' ? (
        <View style={styles.panel}>
          <Text style={styles.mutedLabel}>Email code</Text>
          <TextInput
            style={styles.codeInput}
            value={emailCode}
            onChangeText={setEmailCode}
            placeholder="Code from the SafeTrade email"
            placeholderTextColor="#3f3f46"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            importantForAutofill="yes"
            editable={!busy}
          />
          <Text style={styles.mutedLabel}>2FA code</Text>
          <TextInput
            style={styles.codeInput}
            value={otpCode}
            onChangeText={setOtpCode}
            placeholder="Authenticator code"
            placeholderTextColor="#3f3f46"
            autoCorrect={false}
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            importantForAutofill="yes"
            keyboardType="number-pad"
            editable={!busy}
          />
        </View>
      ) : null}

      {panel === 'limit' ? (
        <View style={styles.summary}>
          <View style={styles.rowBetween}>
            <Text style={styles.mutedLabel}>Open on this market</Text>
            <TouchableOpacity onPress={() => marketId && void loadOrders(marketId)} disabled={!marketId || ordersBusy || !rows}>
              <Text style={styles.copyLink}>{ordersBusy ? 'Loading…' : 'Refresh'}</Text>
            </TouchableOpacity>
          </View>
          {!rows ? <Text style={styles.mutedLabel}>Check balances first.</Text> : null}
          {ordersError ? <Text style={styles.warn}>{ordersError}</Text> : null}
          {rows && !ordersError && openOrders.length === 0 && !ordersBusy ? (
            <Text style={styles.mutedLabel}>No open orders.</Text>
          ) : null}
          {openOrders.map((order) => {
            const known = pair?.market;
            const baseUnit = known?.base.toUpperCase() ?? '';
            const quoteUnit = known?.quote.toUpperCase() ?? '';
            const left = orderLeft(order);
            const sideLabel = order.side === 'sell' ? 'Sell' : 'Buy';
            return (
              <View key={order.id} style={styles.orderRow}>
                <Text style={[styles.orderSide, order.side === 'sell' ? styles.orderSell : styles.orderBuy]}>
                  {sideLabel}
                </Text>
                <Text style={styles.orderAmount}>
                  {formatBalance(left)} {baseUnit} at {order.price || '—'} {quoteUnit}
                  {order.filled > 0 ? ` · filled ${formatBalance(order.filled)}` : ''}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setCancelTarget(order);
                    setReviewOpen(true);
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel ${sideLabel} order`}
                >
                  <Text style={styles.copyLink}>Cancel</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : null}

      {!rows ? <Text style={styles.hint}>Check balances first.</Text> : null}
      {problem ? <Text style={styles.warn}>{problem}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.cta, ctaDisabled && styles.ctaDisabled]}
        onPress={() => { void beginReview(); }}
        disabled={ctaDisabled}
      >
        {busy || flow.busy ? (
          <ActivityIndicator size="small" color="#e4e4e7" />
        ) : (
          <Text style={styles.ctaText}>{panel === 'swap' ? 'Review swap' : panel === 'limit' ? 'Review limit' : moveDir === 'deposit' ? 'Review deposit' : 'Review withdraw'}</Text>
        )}
      </TouchableOpacity>
      <SpendConfirm
        open={reviewOpen}
        title={cancelTarget ? 'Cancel order' : title}
        rows={cancelTarget ? [
          { label: 'Side', value: cancelTarget.side === 'sell' ? 'Sell' : 'Buy' },
          { label: 'Still open', value: `${formatBalance(orderLeft(cancelTarget))} ${pair?.market.base.toUpperCase() ?? ''}` },
          { label: 'Price', value: `${cancelTarget.price || '—'} ${pair?.market.quote.toUpperCase() ?? ''}` },
          { label: 'Market', value: pairName || cancelTarget.market },
        ] : panel === 'limit' ? [
          { label: 'You pay', value: `${amount.trim() || '—'} ${pay.symbol}` },
          { label: 'You receive if it fills', value: `${receiveText} ${receive.symbol}` },
          { label: 'Limit price', value: limitPx != null ? `${limitPx} ${pair?.market.quote.toUpperCase() ?? ''}` : '…' },
          { label: 'Order size', value: limitSize > 0 ? `${formatBalance(limitSize)} ${pair?.market.base.toUpperCase() ?? ''}` : '…' },
          { label: 'Market', value: pair ? pairName : 'No direct market' },
        ] : panel === 'swap' && slippageBps == null ? [
          { label: 'You pay', value: `${amount.trim() || '—'} ${pay.symbol}` },
          { label: 'You receive about', value: `${reviewFill ? (pair?.side === 'sell' ? floorText(reviewFill.quote, pair?.market.totalPlaces ?? 4) : floorText(reviewFill.base, pair?.market.amountPlaces ?? 4)) : receiveText} ${receive.symbol}` },
          { label: 'Average price', value: reviewFill ? `${reviewFill.averagePrice.toFixed(pair?.market.pricePlaces ?? 0)} ${pair?.market.quote.toUpperCase() ?? ''}` : '…' },
          { label: 'Slippage', value: reviewFill ? slippagePercent(reviewFill) : '…' },
          { label: 'Slippage amount', value: reviewFill ? slippageAmountText(reviewFill, pair?.market.quote.toUpperCase() ?? '', pair?.market.totalPlaces ?? 4) : '…' },
          { label: 'Book', value: reviewFill ? coverageText(reviewFill, pair?.market.base.toUpperCase() ?? '', pair?.market.quote.toUpperCase() ?? '', pair?.market.amountPlaces ?? 4, pair?.market.totalPlaces ?? 4) : '…' },
          { label: 'Slippage limit', value: 'Off' },
          { label: 'Market', value: pair ? pairName : 'No direct market' },
        ] : panel === 'swap' ? [
          { label: 'You pay', value: `${amount.trim() || '—'} ${pay.symbol}` },
          { label: 'You receive about', value: `${receiveText} ${receive.symbol}` },
          { label: 'At the worst price', value: atLeast ? `${atLeast} ${pair?.side === 'sell' ? pair.market.quote.toUpperCase() : receive.symbol}` : '…' },
          { label: 'Slippage', value: slippageLabel },
          { label: 'Worst price', value: worstPrice != null ? `${worstPrice.toFixed(pair?.market.pricePlaces ?? 0)} ${pair?.market.quote.toUpperCase() ?? ''}` : '…' },
          { label: 'Network', value: network },
          { label: 'Market', value: pair ? pairName : 'No direct market' },
        ] : [
          { label: moveDir === 'deposit' ? 'Deposit' : 'Withdraw', value: `${amount.trim() || '—'} ${route.symbol}` },
          { label: 'Network', value: network },
          { label: moveDir === 'deposit' ? 'From this wallet' : 'To', value: destination || '—' },
        ]}
        confirmLabel={cancelTarget ? 'Cancel order' : cta}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        onCancel={() => {
          const canceling = cancelTarget != null;
          flow.close(() => {
            if (!canceling) setAmount('');
          });
          setCancelTarget(null);
          setReviewFill(null);
          setReviewOpen(false);
        }}
        onConfirm={() => { void (cancelTarget ? cancelOrder() : submit()); }}
      />
    </View>
  );
};

function addressFor(
  route: SafeRoute,
  own: { wartAddress: string; ethAddress: string; btcAddress: string; solAddress: string },
): string {
  if (route.chain === 'wart') return own.wartAddress;
  if (route.chain === 'ethereum') return own.ethAddress;
  if (route.chain === 'bitcoin') return own.btcAddress;
  return own.solAddress;
}

function sameAddress(route: SafeRoute, dest: string, own: string): boolean {
  if (!dest || !own) return false;
  if (route.chain === 'solana') return dest === own;
  return dest.toLowerCase() === own.toLowerCase();
}

function walletMaxWart(freeText: string): string {
  const free = Number(freeText);
  const fee = Number(DEFAULT_FEE);
  if (!Number.isFinite(free) || free <= fee) return '';
  return floorText(free - fee, 8);
}

async function sendDeposit(input: {
  route: SafeRoute;
  dest: string;
  amount: string;
  node: string;
  nextNonce: number;
  from: string;
  onWartSent: (nextNonce: number) => void;
  onNotice: (text: string) => void;
}): Promise<string> {
  const { route, dest, amount } = input;
  if (route.chain === 'wart') {
    if (isLedgerSession()) {
      input.onNotice('Approve the WART send on the Ledger. The Warthog app must stay open.');
    }
    const sent = await sendWartFromWallet({
      node: input.node,
      nonceId: input.nextNonce,
      fromAddress: input.from,
      toAddress: dest,
      amount,
    });
    input.onWartSent(sent.nextNonce);
    return `Sent ${amount} WART to SafeTrade. Tx ${sent.txHash}.`;
  }
  if (route.chain === 'bitcoin') {
    if (isLedgerSession()) {
      input.onNotice('Approve the Bitcoin send on the Ledger. The Bitcoin app must stay open.');
    }
    const sent = await sendBtc(dest, amount);
    return `Sent ${amount} BTC to SafeTrade. Tx ${sent.txid}.`;
  }
  if (route.chain === 'solana') {
    if (route.currency === 'sol') {
      if (isLedgerSession()) {
        input.onNotice('Approve the SOL send on the Ledger. The Solana app must stay open.');
      }
      const sent = await sendSol(dest, amount);
      return `Sent ${amount} SOL to SafeTrade. Tx ${sent.signature}.`;
    }
    if (route.currency === 'usdc' || route.currency === 'usdt') {
      if (isLedgerSession()) {
        input.onNotice(`Approve the ${route.symbol} send on the Ledger. Blind signing has to be on in the Solana app.`);
      }
      const sent = await sendSpl({
        mint: route.currency === 'usdc' ? USDC_MINT : USDT_MINT,
        decimals: route.decimals,
        toOwner: dest,
        amount,
        symbol: route.symbol,
      });
      return `Sent ${amount} ${route.symbol} to SafeTrade. Tx ${sent.signature}.`;
    }
    throw new Error('This wallet cannot send that Solana token yet.');
  }
  if (route.currency !== 'eth' && route.currency !== 'usdt') {
    throw new Error(`This wallet cannot send ${route.symbol} on ${route.network} yet.`);
  }
  if (isLedgerSession()) {
    input.onNotice('Approve the send on the Ledger. The Ethereum app must stay open.');
  }
  const sent = await sendEthAsset(route.currency === 'eth' ? 'ETH' : 'USDT', dest, amount);
  return `Sent ${amount} ${route.symbol} to SafeTrade. Tx ${sent.hash}.`;
}

function bookLine(book: Book, asset: string, rows: SpotBalance[] | null, destination: string): string {
  if (book === 'saved') return `On the SafeTrade ${asset} withdraw list. The next withdraw needs only the 2FA code.`;
  if (book === 'pending') return 'Saved on SafeTrade, still waiting to become active.';
  if (book === 'missing') {
    return `Not on the SafeTrade ${asset} withdraw list yet. The first withdraw emails a code and needs the 2FA code.`;
  }
  if (book === 'error') return `Could not read the SafeTrade ${asset} withdraw list.`;
  if (rows && destination) return `Checking the SafeTrade ${asset} withdraw list…`;
  return '';
}

function PickPill({
  label,
  symbol,
  groups,
  selectedId,
  locked = false,
  onSelect,
  accessibilityLabel,
  boundsRef,
}: {
  label: string;
  symbol: string;
  groups: { title: string; choices: MenuChoice[] }[];
  selectedId: string;
  locked?: boolean;
  onSelect: (id: string) => void;
  accessibilityLabel: string;
  boundsRef?: React.RefObject<View | null>;
}) {
  const box = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number } | null>(null);

  const show = () => {
    if (locked) return;
    const node = box.current;
    const place = (x: number, y: number, width: number, height: number, bounds: { x: number; width: number } | null) => {
      const margin = 8;
      const gap = 6;
      const screen = Dimensions.get('window');
      const limitLeft = Math.max(margin, bounds ? bounds.x + margin : margin);
      const limitRight = Math.min(screen.width - margin, bounds ? bounds.x + bounds.width - margin : screen.width - margin);
      const below = screen.height - (y + height) - margin;
      const above = y - margin;
      const dropDown = below >= 96 || below >= above;
      // Right edge stays on the pill, and inside the swap card.
      const rightEdge = Math.min(x + width, limitRight);
      let left = rightEdge - 240;
      if (left < limitLeft) left = limitLeft;
      const menuWidth = Math.max(120, Math.min(240, rightEdge - left));
      left = rightEdge - menuWidth;
      setAnchor(dropDown
        ? { top: y + height + gap, left, width: menuWidth, maxHeight: Math.max(96, Math.min(320, below - gap)) }
        : { bottom: screen.height - y + gap, left, width: menuWidth, maxHeight: Math.max(96, Math.min(320, above - gap)) });
      setOpen(true);
    };
    const finish = (x: number, y: number, width: number, height: number) => {
      const card = boundsRef?.current;
      if (!card) {
        place(x, y, width, height, null);
        return;
      }
      card.measureInWindow((cx, _cy, cw) => place(x, y, width, height, { x: cx, width: cw }));
    };
    if (!node) {
      finish(24, 120, 80, 32);
      return;
    }
    node.measureInWindow((x, y, width, height) => finish(x, y, width, height));
  };

  const pill = (
    <>
      <TokenIcon symbol={symbol} size={22} />
      <Text style={styles.tokenPillText}>{label}</Text>
      {locked ? null : <Text style={styles.tokenChevron}>▾</Text>}
    </>
  );

  return (
    <View ref={box} collapsable={false} style={styles.pillSlot}>
      {locked ? (
        <View style={styles.tokenPill}>{pill}</View>
      ) : (
        <TouchableOpacity
          style={styles.tokenPill}
          onPress={show}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ expanded: open }}
        >
          {pill}
        </TouchableOpacity>
      )}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              defiStyles.chainMenu,
              anchor
                ? { top: anchor.top, bottom: anchor.bottom, left: anchor.left, width: anchor.width, maxHeight: anchor.maxHeight }
                : { top: 120, right: 24, width: 240, maxHeight: 320 },
            ]}
            onPress={(event) => event.stopPropagation()}
            accessibilityRole="menu"
          >
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: Math.max(80, (anchor?.maxHeight ?? 320) - 12) }}>
              {groups.map((group) => (
                <View key={group.title || 'network'}>
                  {group.title ? <Text style={styles.menuGroup}>{group.title}</Text> : null}
                  {group.choices.map((choice) => {
                    const on = choice.id === selectedId;
                    return (
                      <TouchableOpacity
                        key={choice.id}
                        style={[defiStyles.chainOption, on && defiStyles.chainOptionOn]}
                        onPress={() => {
                          onSelect(choice.id);
                          setOpen(false);
                        }}
                        accessibilityRole="menuitem"
                        accessibilityLabel={choice.hint ? `${choice.label} ${choice.hint}` : choice.label}
                        accessibilityState={{ selected: on }}
                      >
                        <TokenIcon symbol={choice.symbol} size={22} />
                        <View style={{ flex: 1 }}>
                          <Text style={[defiStyles.chainOptionText, on && defiStyles.chainOptionTextOn]}>{choice.label}</Text>
                          {choice.hint ? <Text style={styles.menuHint}>{choice.hint}</Text> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  swapCard: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(231, 147, 0, 0.3)',
    borderTopWidth: 2,
    borderTopColor: defiColors.gold,
    backgroundColor: 'rgba(24, 24, 27, 0.75)',
    padding: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(39, 39, 42, 0.5)',
  },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 2 },
  cardTitle: { color: '#f4f4f5', fontSize: 14, fontWeight: '600' },
  cardSub: { color: '#52525b', fontSize: 11 },
  headerMark: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  brandMark: { width: 24, height: 24 },
  priceBlock: { alignItems: 'flex-end' },
  spotLabel: { color: '#52525b', fontSize: 9, letterSpacing: 0.6, marginBottom: 2 },
  spotValue: { color: '#d4d4d8', fontSize: 11 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  modeChips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(63, 63, 70, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.75)',
  },
  chipOn: {
    backgroundColor: 'rgba(253, 185, 19, 0.14)',
    borderColor: 'rgba(253, 185, 19, 0.75)',
  },
  chipOff: { opacity: 0.4 },
  chipText: { color: '#e4e4e7', fontSize: 11, fontWeight: '600' },
  chipTextOn: { color: defiColors.gold },
  menuGroup: {
    color: '#71717a',
    fontSize: 10,
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 2,
  },
  menuHint: { color: defiColors.textMuted, fontSize: 11, marginTop: 1 },
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.95)',
    backgroundColor: 'rgba(24, 24, 27, 0.55)',
    padding: 12,
  },
  mutedLabel: { color: '#71717a', fontSize: 11, marginBottom: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, width: '100%' },
  pillSlot: { flexGrow: 0, flexShrink: 0, maxWidth: '100%' },
  amountInput: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, color: '#fff', fontSize: 22, fontWeight: '600', padding: 0 },
  tokenPill: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(9, 9, 11, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.9)',
  },
  tokenPillText: { color: '#fafafa', fontSize: 13, fontWeight: '600' },
  tokenChevron: { color: '#a1a1aa', fontSize: 10 },
  flipWrap: { alignItems: 'center', marginVertical: -10, zIndex: 2 },
  flipBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(63, 63, 70, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipMark: { color: '#a1a1aa', fontSize: 16 },
  balanceHint: { color: '#71717a', fontSize: 10, textAlign: 'right' },
  lockedHint: { color: defiColors.amberText, fontSize: 10, textAlign: 'right' },
  summary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.8)',
    backgroundColor: 'rgba(9, 9, 11, 0.45)',
    padding: 10,
    gap: 6,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orderSide: { fontSize: 11, fontWeight: '700', width: 32 },
  orderBuy: { color: defiColors.buy },
  orderSell: { color: defiColors.sell },
  orderAmount: { color: '#d4d4d8', fontSize: 11, flex: 1 },
  summaryValue: { color: '#d4d4d8', fontSize: 11 },
  copyLink: { color: defiColors.goldHover, fontSize: 11, fontWeight: '600', marginTop: 2 },
  bookLine: { color: defiColors.gold, fontSize: 11, lineHeight: 16 },
  codeInput: { color: '#fff', fontSize: 16, padding: 0, marginBottom: 8 },
  hint: { textAlign: 'center', color: '#a1a1aa', fontSize: 11, lineHeight: 16 },
  notice: { color: defiColors.gold, fontSize: 12, lineHeight: 16 },
  warn: { color: '#f87171', fontSize: 12, lineHeight: 16 },
  cta: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(39, 39, 42, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.65)',
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: '#e4e4e7', fontSize: 15, fontWeight: '600' },
  book: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.8)',
    backgroundColor: 'rgba(9, 9, 11, 0.45)',
    padding: 10,
    gap: 2,
  },
  bookHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  bookHeadText: { flex: 1, color: '#71717a', fontSize: 10 },
  bookNum: { textAlign: 'right' },
  bookRow: { flexDirection: 'row', alignItems: 'center', minHeight: 22, position: 'relative' },
  bookBar: { position: 'absolute', top: 1, bottom: 1, right: 0, borderRadius: 2 },
  bookBarSell: { backgroundColor: 'rgba(251, 113, 133, 0.16)' },
  bookBarBuy: { backgroundColor: 'rgba(52, 211, 153, 0.16)' },
  bookBarSellHot: { backgroundColor: 'rgba(251, 113, 133, 0.4)' },
  bookBarBuyHot: { backgroundColor: 'rgba(52, 211, 153, 0.4)' },
  bookPrice: { flex: 1, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], zIndex: 1 },
  bookAmt: { flex: 1, textAlign: 'right', color: '#d4d4d8', fontSize: 11, fontVariant: ['tabular-nums'], zIndex: 1 },
  bookMid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    marginVertical: 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(63, 63, 70, 0.65)',
  },
  bookLast: { color: '#fafafa', fontSize: 15, fontWeight: '700' },
  bookQuote: { color: '#71717a', fontSize: 11, fontWeight: '500' },
});

function OrderBook({
  market,
  depth,
  error,
  busy,
  last,
  change,
  touched,
  touchSide,
  onPickPrice,
  onRefresh,
}: {
  market: SafeMarket;
  depth: SafeDepth | null;
  error: string;
  busy: boolean;
  last: string;
  change: string;
  touched: number;
  touchSide: 'buy' | 'sell';
  onPickPrice?: (price: string) => void;
  onRefresh: () => void;
}) {
  const quote = market.quote.toUpperCase();
  const base = market.base.toUpperCase();
  const asks = (depth?.asks ?? []).slice(0, BOOK_ROWS).reverse();
  const bids = (depth?.bids ?? []).slice(0, BOOK_ROWS);
  const maxAmount = Math.max(1e-12, ...asks.map((row) => row.amount), ...bids.map((row) => row.amount));
  const changeText = formatChange(change);
  const changeDown = changeText.startsWith('-');
  const changeUp = changeText.startsWith('+');
  const levelRow = (level: { price: number; amount: number }, side: 'buy' | 'sell', hot: boolean) => {
    const width = Math.min(100, (level.amount / maxAmount) * 100);
    const priceText = level.price.toFixed(market.pricePlaces);
    const body = (
      <View style={styles.bookRow}>
        <View
          style={[
            styles.bookBar,
            { width: `${width}%` },
            side === 'sell' ? styles.bookBarSell : styles.bookBarBuy,
            hot && (side === 'sell' ? styles.bookBarSellHot : styles.bookBarBuyHot),
          ]}
        />
        <Text style={[styles.bookPrice, side === 'sell' ? styles.orderSell : styles.orderBuy]}>{priceText}</Text>
        <Text style={styles.bookAmt}>{formatBook(level.amount, market.amountPlaces)}</Text>
        <Text style={styles.bookAmt}>{formatBook(level.price * level.amount, market.totalPlaces)}</Text>
      </View>
    );
    if (!onPickPrice) return body;
    return (
      <TouchableOpacity
        onPress={() => onPickPrice(priceText)}
        accessibilityRole="button"
        accessibilityLabel={`Use ${priceText} ${quote} as the limit price`}
      >
        {body}
      </TouchableOpacity>
    );
  };
  return (
    <View style={styles.book}>
      <View style={styles.rowBetween}>
        <Text style={styles.mutedLabel}>{base}/{quote} order book</Text>
        <TouchableOpacity onPress={onRefresh} disabled={busy} accessibilityRole="button" accessibilityLabel="Refresh order book">
          <Text style={styles.copyLink}>{busy ? 'Loading…' : 'Refresh'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.bookHead}>
        <Text style={styles.bookHeadText}>Price ({quote})</Text>
        <Text style={[styles.bookHeadText, styles.bookNum]}>Amount ({base})</Text>
        <Text style={[styles.bookHeadText, styles.bookNum]}>Sum ({quote})</Text>
      </View>
      {busy && !depth ? <Text style={styles.mutedLabel}>Reading the book…</Text> : null}
      {error && !depth ? <Text style={styles.warn}>{error}</Text> : null}
      {asks.map((level, index) => (
        <View key={`ask-${level.price}`}>
          {levelRow(level, 'sell', touchSide === 'buy' && asks.length - 1 - index < touched)}
        </View>
      ))}
      <View style={styles.bookMid}>
        <Text style={styles.bookLast}>
          {last || '…'}
          <Text style={styles.bookQuote}> {quote}</Text>
        </Text>
        {changeText ? (
          <Text style={changeDown ? styles.orderSell : changeUp ? styles.orderBuy : styles.bookQuote}>{changeText}</Text>
        ) : null}
      </View>
      {bids.map((level, index) => (
        <View key={`bid-${level.price}`}>
          {levelRow(level, 'buy', touchSide === 'sell' && index < touched)}
        </View>
      ))}
      {depth && asks.length === 0 && bids.length === 0 ? (
        <Text style={styles.mutedLabel}>No orders on this market.</Text>
      ) : null}
      {touched > BOOK_ROWS ? (
        <Text style={styles.mutedLabel}>The average also includes prices past these rows.</Text>
      ) : null}
      {onPickPrice ? <Text style={styles.mutedLabel}>Tap a price to use it as the limit.</Text> : null}
    </View>
  );
}

export default SafeTradeCard;
