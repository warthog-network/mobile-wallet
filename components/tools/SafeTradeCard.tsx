import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
  safeCoinAddressBook,
  safeDepositAddress,
  safePair,
  safePublicNetwork,
  safeSwap,
  safeTicker,
  safeWaitOrder,
  safeWithdrawCoin,
  type SafeNetworkLimits,
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
import { isLedgerSession } from '../../utils/sessionVault';
import { isDefiNode } from '../../utils/nodes';
import { NetworkModeBadge } from '../defi/WartMainnetHolding';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';

type Panel = 'swap' | 'move';
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

function rowOf(rows: SpotBalance[], asset: string): SpotBalance {
  return rows.find((item) => item.asset === asset) ?? { asset, available: 0, locked: 0 };
}

function freeMessage(asset: string, free: number, locked: number): string {
  const lockedPart = locked > 0 ? `; ${formatBalance(locked)} locked in open orders` : '';
  return `Only ${formatBalance(free)} ${asset} free${lockedPart}.`;
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
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const checked = rows != null;
  const coinChoices = coinsOn(network);
  const payCurrent = choiceById(payPick);
  const pay = coinChoices.find((row) => row.id === payPick)
    ?? coinChoices.find((row) => row.currency === payCurrent.currency)
    ?? payCurrent;
  const receive = choiceById(receivePick);
  const moveCurrent = choiceById(movePick);
  const moveChoice = coinChoices.find((row) => row.id === movePick)
    ?? coinChoices.find((row) => row.currency === moveCurrent.currency)
    ?? coinChoices[0]
    ?? SWAP_CHOICES[0];
  const route = SAFE_ROUTES.find((item) => item.currency === moveChoice.currency && item.network === network) ?? SAFE_ROUTES[0];
  const pair = panel === 'swap' ? safePair(pay.currency, receive.currency) : null;
  const pairName = pair ? `${pair.market.base.toUpperCase()}/${pair.market.quote.toUpperCase()}` : '';
  const price = quote && quote.market === pairName ? Number(quote.last) : 0;
  const payValue = parseAmount(amount);
  const live = liveOf(route, limits);
  const paySymbol = panel === 'swap' ? pay.symbol : route.symbol;

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

  useEffect(() => {
    if (panel !== 'swap' || !pair) return undefined;
    let cancel = false;
    if (pair.market.id !== 'wartusdt') setQuote(null);
    void safeTicker(pair.market.id).then((next) => {
      if (!cancel) setQuote(next);
    }).catch(() => {
      if (!cancel && pair.market.id !== 'wartusdt') setQuote(null);
    });
    return () => {
      cancel = true;
    };
  }, [panel, pair?.market.id]);

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
    } else {
      setWalletSol(null);
      setWalletSolMax('');
    }
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
    return { text: '—', max: '', pending: false, failed: false, locked: '' };
  }, [
    route, walletWartFree, walletWartLocked, walletEth, walletUsdt, walletBtc, walletBtcMax,
    walletSol, walletSolMax, failed, ethAddress, btcAddress, solAddress,
  ]);

  const exchangeRow = rowOf(rows ?? [], paySymbol);
  const receiveText = useMemo(() => {
    if (payValue == null) return '0';
    if (panel === 'swap') {
      if (!(price > 0) || !pair) return '0';
      return formatBalance(pair.side === 'sell' ? payValue * price : payValue / price);
    }
    if (moveDir === 'withdraw') return formatBalance(Math.max(0, payValue - live.fee));
    return formatBalance(payValue);
  }, [payValue, panel, price, pair, moveDir, live.fee]);

  const maxAmount = (): string => {
    if (!rows) return '';
    if (panel === 'swap') {
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
    if (panel === 'swap') {
      if (!pair) return `SafeTrade has no ${pay.symbol}/${receive.symbol} market.`;
      const base = pair.market.base.toUpperCase();
      if (pair.side === 'sell' && payValue < pair.market.minBase) {
        return `Minimum ${base} sell is ${pair.market.minBase}.`;
      }
      if (pair.side === 'buy' && price > 0 && payValue / price < pair.market.minBase) {
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
    rows, payValue, panel, pair, pay.symbol, receive.symbol, price, exchangeRow, moveDir, route,
    live, destination, wartAddress, node, walletWartFree, walletSide,
  ]);

  const available = panel === 'swap' || moveDir === 'withdraw'
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
    const receiveOnNetwork = coins.find((row) => row.currency === receive.currency);
    const receiveStillPairs = receive.currency !== payNext.currency && Boolean(safePair(payNext.currency, receive.currency));
    if (receiveOnNetwork && receiveOnNetwork.currency !== payNext.currency) {
      setReceivePick(receiveOnNetwork.id);
    } else if (receiveStillPairs) {
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
    } else {
      setReceivePick(next.id);
    }
    clearEntry();
  };

  const chooseMove = (id: string) => {
    setMovePick(id);
    clearEntry();
  };

  const flip = () => {
    if (panel === 'swap') {
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
      : moveDir === 'deposit'
        ? `Sending ${amount.trim()} ${route.symbol} to SafeTrade…`
        : `Withdrawing ${amount.trim()} ${route.symbol}…`;
    flow.begin(action);
    setBusy(true);
    try {
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
        const placed = await safeSwap(creds, { market: pair.market, side: pair.side, amount: value });
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

  const copyDeposit = (value: string) => {
    if (!value) return;
    void Clipboard.setStringAsync(value);
    setNotice('Deposit address copied.');
    setError('');
  };

  const title = panel === 'swap'
    ? 'Swap'
    : moveDir === 'deposit'
      ? `Deposit ${route.symbol}`
      : `Withdraw ${route.symbol}`;
  const subtitle = panel === 'swap'
    ? (pair ? `${pay.symbol} for ${receive.symbol}` : `${pay.symbol} / ${receive.symbol}`)
    : moveDir === 'deposit'
      ? `${route.network} → SafeTrade`
      : `SafeTrade → ${route.network}`;
  const depositAddress = deposits[route.id] ?? '';
  const book = books[route.id] ?? null;
  const waitingBalance = panel === 'move' && moveDir === 'deposit' && walletSide.pending;
  const filledMax = maxAmount();
  const ctaDisabled = !rows || busy || payValue == null || Boolean(problem) || waitingBalance;
  const cta = panel === 'swap'
    ? `Swap ${pay.symbol} for ${receive.symbol}`
    : moveDir === 'deposit'
      ? `Deposit ${route.symbol}`
      : `Withdraw ${route.symbol}`;
  const coinGroups = coinMenu(coinChoices, network);
  const receiveRows = [
    ...coinChoices,
    ...marketPartners(pay.currency, network).filter(
      (row) => !coinChoices.some((coin) => coin.currency === row.currency),
    ),
  ];

  const summaryRows: { label: string; value: string }[] = [];
  if (panel === 'swap') {
    summaryRows.push({ label: 'Price', value: price > 0 && quote ? `${quote.last} ${pair?.market.quote.toUpperCase()}` : '…' });
    if (pair?.side === 'sell') summaryRows.push({ label: 'Minimum', value: `${pair.market.minBase} ${pair.market.base.toUpperCase()}` });
    if (pair?.side === 'buy') summaryRows.push({ label: 'Minimum', value: `${pair.market.minBase} ${pair.market.base.toUpperCase()}` });
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

  const payMenu = (
    <PickPill
      label={panel === 'swap' ? pay.symbol : route.symbol}
      symbol={panel === 'swap' ? pay.symbol : route.symbol}
      groups={coinGroups}
      selectedId={panel === 'swap' ? pay.id : moveChoice.id}
      locked={coinChoices.length < 2}
      onSelect={(id) => (panel === 'swap' ? chooseSwap('pay', id) : chooseMove(id))}
      accessibilityLabel={panel === 'swap' ? `Choose ${pay.symbol}` : `Choose ${route.symbol}`}
      boundsRef={cardRef}
    />
  );
  const receiveMenu = panel === 'swap' ? (
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
        {panel === 'swap' ? (
          <View style={styles.priceBlock}>
            <Text style={styles.spotLabel}>PRICE</Text>
            <Text style={styles.spotValue}>
              {price > 0 && quote ? quote.last : '…'}
              <Text style={styles.mutedLabel}> {pair?.market.quote.toUpperCase() || 'USDT'}</Text>
            </Text>
          </View>
        ) : null}
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
            style={[styles.chip, panel === 'move' && styles.chipOn]}
            onPress={() => switchPanel('move')}
            accessibilityRole="button"
            accessibilityState={{ selected: panel === 'move' }}
          >
            <Text style={[styles.chipText, panel === 'move' && styles.chipTextOn]}>Move</Text>
          </TouchableOpacity>
        </View>
        {networkMenu}
      </View>

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
              ? 'Estimate · before the trading fee'
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
        {panel === 'swap' ? (
          <Text style={styles.mutedLabel}>Stays on SafeTrade until you withdraw.</Text>
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

      {!rows ? <Text style={styles.hint}>Check balances first.</Text> : null}
      {problem ? <Text style={styles.warn}>{problem}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.warn}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.cta, ctaDisabled && styles.ctaDisabled]}
        onPress={() => {
          setError('');
          if (payValue == null) {
            setError('Enter an amount.');
            return;
          }
          if (problem) {
            setError(problem);
            return;
          }
          setReviewOpen(true);
        }}
        disabled={ctaDisabled}
      >
        {busy || flow.busy ? (
          <ActivityIndicator size="small" color="#e4e4e7" />
        ) : (
          <Text style={styles.ctaText}>{panel === 'swap' ? 'Review swap' : moveDir === 'deposit' ? 'Review deposit' : 'Review withdraw'}</Text>
        )}
      </TouchableOpacity>
      <SpendConfirm
        open={reviewOpen}
        title={title}
        rows={panel === 'swap' ? [
          { label: 'You pay', value: `${amount.trim() || '—'} ${pay.symbol}` },
          { label: 'You receive', value: receive.symbol },
          { label: 'Network', value: network },
          { label: 'Market', value: pair ? pairName : 'No direct market' },
        ] : [
          { label: moveDir === 'deposit' ? 'Deposit' : 'Withdraw', value: `${amount.trim() || '—'} ${route.symbol}` },
          { label: 'Network', value: network },
          { label: moveDir === 'deposit' ? 'From this wallet' : 'To', value: destination || '—' },
        ]}
        confirmLabel={cta}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        onCancel={() => {
          flow.close(() => setAmount(''));
          setReviewOpen(false);
        }}
        onConfirm={() => { void submit(); }}
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
    if (route.currency !== 'sol') throw new Error('This wallet cannot send that Solana token yet.');
    if (isLedgerSession()) {
      input.onNotice('Approve the SOL send on the Ledger. The Solana app must stay open.');
    }
    const sent = await sendSol(dest, amount);
    return `Sent ${amount} SOL to SafeTrade. Tx ${sent.signature}.`;
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
  priceBlock: { alignItems: 'flex-end' },
  spotLabel: { color: '#52525b', fontSize: 9, letterSpacing: 0.6, marginBottom: 2 },
  spotValue: { color: '#d4d4d8', fontSize: 11 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  modeChips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
});

export default SafeTradeCard;
