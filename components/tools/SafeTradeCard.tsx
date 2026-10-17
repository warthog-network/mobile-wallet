import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { defiColors } from '../defi/defiStyles';
import TokenIcon from '../TokenIcon';
import { DEFAULT_FEE } from '../../constants';
import { explainExchangeFailure } from '../../utils/exchange/http';
import {
  loadSafeTradeCredentials,
  safeBalances,
  safeBuyWart,
  safeCoinAddressBook,
  safeDepositAddress,
  safePublicNetwork,
  safeSellWart,
  safeWaitOrder,
  safeWartAddressBook,
  safeWithdrawCoin,
  safeWithdrawWart,
  USDT_DEPOSIT,
  USDT_ETH,
  WART_DEPOSIT,
  WART_USDT_MARKET,
  WART_WITHDRAW,
  type SpotBalance,
  type WartAddressBook,
} from '../../utils/exchange/safetrade';
import { sendEthAsset } from '../../utils/ethChain';
import { readEthereumHoldings } from '../../utils/ethHoldings';
import { sendWartFromWallet } from '../../utils/exchange/walletSend';
import { isDefiNode } from '../../utils/nodes';

type ActionId =
  | 'sell-usdt'
  | 'sell-wart'
  | 'deposit-wart'
  | 'deposit-usdt'
  | 'withdraw-wart'
  | 'withdraw-usdt';
type Asset = 'WART' | 'USDT';
type Book = WartAddressBook | 'error' | null;

const ACTIONS: { id: ActionId; label: string; group: 'Swap' | 'Move' }[] = [
  { id: 'sell-usdt', label: 'Sell USDT for WART', group: 'Swap' },
  { id: 'sell-wart', label: 'Sell WART for USDT', group: 'Swap' },
  { id: 'deposit-wart', label: 'Deposit WART', group: 'Move' },
  { id: 'deposit-usdt', label: 'Deposit USDT', group: 'Move' },
  { id: 'withdraw-wart', label: 'Withdraw WART', group: 'Move' },
  { id: 'withdraw-usdt', label: 'Withdraw USDT', group: 'Move' },
];

const FLIP: Record<ActionId, ActionId> = {
  'sell-usdt': 'sell-wart',
  'sell-wart': 'sell-usdt',
  'deposit-wart': 'withdraw-wart',
  'withdraw-wart': 'deposit-wart',
  'deposit-usdt': 'withdraw-usdt',
  'withdraw-usdt': 'deposit-usdt',
};

function actionAsset(action: ActionId): Asset {
  return action.endsWith('usdt') ? 'USDT' : 'WART';
}

function actionMode(action: ActionId): 'swap' | 'deposit' | 'withdraw' {
  if (action.startsWith('sell')) return 'swap';
  if (action.startsWith('deposit')) return 'deposit';
  return 'withdraw';
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

interface Props {
  rows: SpotBalance[] | null;
  onRows: (rows: SpotBalance[]) => void;
  lastPrice: string;
  wartAddress: string;
  ethAddress: string;
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
  node,
  nextNonce,
  walletWartFree,
  walletWartLocked,
  onWartSent,
}) => {
  const exchangeUsdt = rowOf(rows ?? [], 'USDT');
  const exchangeWart = rowOf(rows ?? [], 'WART');
  const [action, setAction] = useState<ActionId>('sell-usdt');
  const [menuOpen, setMenuOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [wartBook, setWartBook] = useState<Book>(null);
  const [usdtBook, setUsdtBook] = useState<Book>(null);
  const [wartMin, setWartMin] = useState(WART_DEPOSIT.min);
  const [wartConf, setWartConf] = useState(WART_DEPOSIT.confirmations);
  const [wartInOn, setWartInOn] = useState(true);
  const [usdtMinIn, setUsdtMinIn] = useState(USDT_DEPOSIT.min);
  const [usdtConf, setUsdtConf] = useState(USDT_DEPOSIT.confirmations);
  const [usdtInOn, setUsdtInOn] = useState(true);
  const [usdtMinOut, setUsdtMinOut] = useState(USDT_ETH.min);
  const [usdtFee, setUsdtFee] = useState(USDT_ETH.fee);
  const [usdtOutOn, setUsdtOutOn] = useState(true);
  const [wartDeposit, setWartDeposit] = useState('');
  const [usdtDeposit, setUsdtDeposit] = useState('');
  const [depositError, setDepositError] = useState('');
  const [walletUsdt, setWalletUsdt] = useState<string | null>(null);
  const [walletUsdtFailed, setWalletUsdtFailed] = useState(false);

  const checked = rows != null;
  const asset = actionAsset(action);
  const mode = actionMode(action);
  const payAsset: Asset = action === 'sell-usdt' ? 'USDT' : action === 'sell-wart' ? 'WART' : asset;
  const receiveAsset: Asset = action === 'sell-usdt' ? 'WART' : action === 'sell-wart' ? 'USDT' : asset;
  const price = Number(lastPrice);
  const payValue = parseAmount(amount);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const [wartNet, usdtNet] = await Promise.all([
        safePublicNetwork('wart', WART_DEPOSIT.blockchainKey),
        safePublicNetwork('usdt', USDT_ETH.blockchainKey),
      ]);
      if (cancel) return;
      if (wartNet) {
        setWartInOn(wartNet.depositEnabled);
        if (wartNet.minDeposit > 0) setWartMin(wartNet.minDeposit);
        if (wartNet.confirmations > 0) setWartConf(wartNet.confirmations);
      }
      if (usdtNet) {
        setUsdtInOn(usdtNet.depositEnabled);
        setUsdtOutOn(usdtNet.withdrawEnabled);
        if (usdtNet.minDeposit > 0) setUsdtMinIn(usdtNet.minDeposit);
        if (usdtNet.minWithdraw > 0) setUsdtMinOut(usdtNet.minWithdraw);
        if (usdtNet.fee > 0) setUsdtFee(usdtNet.fee);
        if (usdtNet.confirmations > 0) setUsdtConf(usdtNet.confirmations);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ethAddress) {
      setWalletUsdt(null);
      setWalletUsdtFailed(false);
      return;
    }
    let cancel = false;
    setWalletUsdt(null);
    setWalletUsdtFailed(false);
    void readEthereumHoldings(ethAddress).then((holdings) => {
      if (cancel) return;
      const owned = holdings.find((row) => row.symbol === 'USDT')?.amount;
      if (owned == null) {
        setWalletUsdtFailed(true);
        return;
      }
      setWalletUsdt(owned);
    }).catch(() => {
      if (!cancel) setWalletUsdtFailed(true);
    });
    return () => {
      cancel = true;
    };
  }, [ethAddress]);

  useEffect(() => {
    if (!checked) {
      setWartDeposit('');
      setUsdtDeposit('');
      setWartBook(null);
      setUsdtBook(null);
      setDepositError('');
      return;
    }
    let cancel = false;
    void (async () => {
      const creds = await loadSafeTradeCredentials();
      if (cancel) return;
      if (!creds) {
        setDepositError('Save a SafeTrade API key and secret first.');
        return;
      }
      try {
        const address = await safeDepositAddress(creds, 'wart', WART_DEPOSIT.blockchainKey);
        if (!cancel) setWartDeposit(address);
      } catch (err) {
        if (!cancel) setDepositError(explainExchangeFailure(err));
      }
      try {
        const address = await safeDepositAddress(creds, 'usdt', USDT_ETH.blockchainKey);
        if (!cancel) setUsdtDeposit(address);
      } catch (err) {
        if (!cancel) setDepositError(explainExchangeFailure(err));
      }
      if (wartAddress) {
        try {
          const next = await safeWartAddressBook(creds, wartAddress);
          if (!cancel) setWartBook(next);
        } catch {
          if (!cancel) setWartBook('error');
        }
      }
      if (ethAddress) {
        try {
          const next = await safeCoinAddressBook(creds, USDT_ETH, ethAddress);
          if (!cancel) setUsdtBook(next);
        } catch {
          if (!cancel) setUsdtBook('error');
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [checked, wartAddress, ethAddress]);

  const refreshExchange = async () => {
    const creds = await loadSafeTradeCredentials();
    if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
    const next = await safeBalances(creds);
    onRows(next);
    return { creds, rows: next };
  };

  const refreshWartBook = async () => {
    if (!wartAddress) {
      setWartBook(null);
      return;
    }
    const creds = await loadSafeTradeCredentials();
    if (!creds) return;
    try {
      setWartBook(await safeWartAddressBook(creds, wartAddress));
    } catch {
      setWartBook('error');
    }
  };

  const refreshUsdtBook = async () => {
    if (!ethAddress) {
      setUsdtBook(null);
      return;
    }
    const creds = await loadSafeTradeCredentials();
    if (!creds) return;
    try {
      setUsdtBook(await safeCoinAddressBook(creds, USDT_ETH, ethAddress));
    } catch {
      setUsdtBook('error');
    }
  };

  const receiveText = useMemo(() => {
    if (payValue == null) return '0';
    if (action === 'sell-usdt') return price > 0 ? formatBalance(payValue / price) : '0';
    if (action === 'sell-wart') return price > 0 ? formatBalance(payValue * price) : '0';
    if (mode === 'withdraw') {
      const fee = asset === 'WART' ? WART_WITHDRAW.fee : usdtFee;
      return formatBalance(Math.max(0, payValue - fee));
    }
    return formatBalance(payValue);
  }, [payValue, action, mode, price, asset, usdtFee]);

  const maxAmount = (): string => {
    if (!rows) return '';
    if (action === 'sell-usdt') {
      const text = floorText(exchangeUsdt.available, WART_USDT_MARKET.totalPlaces);
      return exchangeUsdt.available > 0 && text !== '0' ? text : '';
    }
    if (action === 'sell-wart') {
      const text = floorText(exchangeWart.available, WART_USDT_MARKET.amountPlaces);
      return exchangeWart.available > 0 && text !== '0' ? text : '';
    }
    if (mode === 'deposit' && asset === 'WART') {
      const free = Number(walletWartFree);
      const fee = Number(DEFAULT_FEE);
      if (!Number.isFinite(free) || free <= fee) return '';
      return floorText(free - fee, 8);
    }
    if (mode === 'deposit') {
      if (walletUsdt == null || !(Number(walletUsdt) > 0)) return '';
      return floorText(Number(walletUsdt), 6);
    }
    if (asset === 'WART') {
      return exchangeWart.available >= WART_WITHDRAW.min ? formatBalance(exchangeWart.available) : '';
    }
    return exchangeUsdt.available >= usdtMinOut ? formatBalance(exchangeUsdt.available) : '';
  };

  const problem = useMemo(() => {
    if (!rows || payValue == null) return '';
    if (action === 'sell-usdt') {
      if (payValue > exchangeUsdt.available + 1e-9) return freeMessage('USDT', exchangeUsdt.available, exchangeUsdt.locked);
      return '';
    }
    if (action === 'sell-wart') {
      if (payValue < WART_USDT_MARKET.minWart) return `Minimum WART sell is ${WART_USDT_MARKET.minWart}.`;
      if (payValue > exchangeWart.available + 1e-9) return freeMessage('WART', exchangeWart.available, exchangeWart.locked);
      return '';
    }
    if (mode === 'deposit' && asset === 'WART') {
      if (!wartInOn) return 'SafeTrade has WART deposits turned off.';
      if (!wartAddress || !node) return 'Open a wallet on Warthog mainnet first.';
      if (isDefiNode(node)) return 'Switch this wallet to Warthog mainnet before sending WART to SafeTrade.';
      if (payValue < wartMin) return `Minimum WART deposit is ${wartMin}.`;
      const free = Number(walletWartFree);
      const fee = Number(DEFAULT_FEE);
      if (Number.isFinite(free) && payValue + fee > free + 1e-8) {
        return `Only ${walletWartFree} WART is free. This send also needs a ${DEFAULT_FEE} WART fee.`;
      }
      return '';
    }
    if (mode === 'deposit') {
      if (!usdtInOn) return 'SafeTrade has Ethereum USDT deposits turned off.';
      if (!ethAddress) return 'This wallet has no Ethereum address.';
      if (payValue < usdtMinIn) return `Minimum Ethereum USDT deposit is ${usdtMinIn}.`;
      if (walletUsdtFailed) return 'Ethereum USDT balance unavailable.';
      if (walletUsdt != null && Number(floorText(payValue, 6)) > Number(walletUsdt) + 1e-9) {
        return `Only ${walletUsdt} USDT is in this wallet.`;
      }
      return '';
    }
    if (asset === 'WART') {
      if (!wartAddress) return 'This wallet has no Warthog address.';
      if (payValue < WART_WITHDRAW.min) return `Minimum WART withdraw is ${WART_WITHDRAW.min}. Fee is ${WART_WITHDRAW.fee}.`;
      if (payValue > exchangeWart.available + 1e-9) return freeMessage('WART', exchangeWart.available, exchangeWart.locked);
      return '';
    }
    if (!usdtOutOn) return 'SafeTrade has Ethereum USDT withdrawals turned off.';
    if (!ethAddress) return 'This wallet has no Ethereum address.';
    if (payValue < usdtMinOut) return `Minimum USDT withdraw is ${usdtMinOut}. Fee is ${usdtFee}.`;
    if (payValue > exchangeUsdt.available + 1e-9) return freeMessage('USDT', exchangeUsdt.available, exchangeUsdt.locked);
    return '';
  }, [
    rows, payValue, action, mode, asset, exchangeUsdt, exchangeWart, wartInOn, wartAddress, node,
    wartMin, walletWartFree, usdtInOn, ethAddress, usdtMinIn, walletUsdt, walletUsdtFailed,
    usdtOutOn, usdtMinOut, usdtFee,
  ]);

  const available = (() => {
    if (action === 'sell-usdt') {
      return {
        text: rows ? formatBalance(exchangeUsdt.available) : '…',
        unit: 'USDT',
        where: 'on SafeTrade',
        locked: rows && exchangeUsdt.locked > 0 ? formatBalance(exchangeUsdt.locked) : '',
      };
    }
    if (action === 'sell-wart') {
      return {
        text: rows ? formatBalance(exchangeWart.available) : '…',
        unit: 'WART',
        where: 'on SafeTrade',
        locked: rows && exchangeWart.locked > 0 ? formatBalance(exchangeWart.locked) : '',
      };
    }
    if (mode === 'deposit' && asset === 'WART') {
      return {
        text: walletWartFree || '…',
        unit: 'WART',
        where: 'in this wallet',
        locked: Number(walletWartLocked) > 0 ? walletWartLocked : '',
      };
    }
    if (mode === 'deposit') {
      return {
        text: walletUsdt == null ? (walletUsdtFailed ? '—' : '…') : walletUsdt,
        unit: 'USDT',
        where: 'in this wallet',
        locked: '',
      };
    }
    const row = asset === 'WART' ? exchangeWart : exchangeUsdt;
    return {
      text: rows ? formatBalance(row.available) : '…',
      unit: asset,
      where: 'on SafeTrade',
      locked: rows && row.locked > 0 ? formatBalance(row.locked) : '',
    };
  })();

  const chooseAction = (next: ActionId) => {
    setAction(next);
    setMenuOpen(false);
    setAmount('');
    setEmailCode('');
    setNotice('');
    setError('');
  };

  const flip = () => {
    chooseAction(FLIP[action]);
  };

  const copyDeposit = (value: string) => {
    if (!value) return;
    void Clipboard.setStringAsync(value);
    setNotice('Deposit address copied.');
    setError('');
  };

  const submit = async () => {
    setNotice('');
    setError('');
    const value = parseAmount(amount);
    if (value == null) {
      setError('Enter an amount.');
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      if (action === 'sell-usdt') {
        const { creds, rows: live } = await refreshExchange();
        const free = rowOf(live, 'USDT');
        if (value > free.available + 1e-9) {
          setAmount(free.available > 0 ? floorText(free.available, WART_USDT_MARKET.totalPlaces) : '');
          setError(freeMessage('USDT', free.available, free.locked));
          return;
        }
        setNotice('Selling USDT for WART…');
        const placed = await safeBuyWart(creds, value);
        const finished = placed.id ? await safeWaitOrder(creds, placed.id) : placed;
        await refreshExchange();
        if (finished.filled > 0) {
          const spent = finished.averagePrice > 0
            ? formatBalance(finished.filled * finished.averagePrice)
            : formatBalance(value);
          setNotice(`Sold ${spent} USDT for ${formatBalance(finished.filled)} WART.`);
          setAmount('');
        } else {
          setNotice(`Order ${finished.id || ''} is ${finished.state || 'open'}. No WART filled yet.`);
        }
        return;
      }
      if (action === 'sell-wart') {
        const { creds, rows: live } = await refreshExchange();
        const free = rowOf(live, 'WART');
        if (value > free.available + 1e-9) {
          setAmount(free.available > 0 ? floorText(free.available, WART_USDT_MARKET.amountPlaces) : '');
          setError(freeMessage('WART', free.available, free.locked));
          return;
        }
        setNotice('Selling WART for USDT…');
        const placed = await safeSellWart(creds, value);
        const finished = placed.id ? await safeWaitOrder(creds, placed.id) : placed;
        await refreshExchange();
        if (finished.filled > 0) {
          const got = finished.averagePrice > 0
            ? formatBalance(finished.filled * finished.averagePrice)
            : '';
          setNotice(
            got
              ? `Sold ${formatBalance(finished.filled)} WART for about ${got} USDT.`
              : `Sold ${formatBalance(finished.filled)} WART.`,
          );
          setAmount('');
        } else {
          setNotice(`Order ${finished.id || ''} is ${finished.state || 'open'}. No WART sold yet.`);
        }
        return;
      }
      if (mode === 'deposit' && asset === 'WART') {
        const creds = await loadSafeTradeCredentials();
        if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
        const dest = wartDeposit || await safeDepositAddress(creds, 'wart', WART_DEPOSIT.blockchainKey);
        setWartDeposit(dest);
        const sent = await sendWartFromWallet({
          node,
          nonceId: nextNonce,
          fromAddress: wartAddress,
          toAddress: dest,
          amount: floorText(value, 8),
        });
        onWartSent(sent.nextNonce);
        setAmount('');
        setNotice(`Sent ${floorText(value, 8)} WART to SafeTrade. Tx ${sent.txHash}. SafeTrade credits it after about ${wartConf} confirmations.`);
        return;
      }
      if (mode === 'deposit') {
        const creds = await loadSafeTradeCredentials();
        if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
        const holdings = await readEthereumHoldings(ethAddress);
        const owned = holdings.find((row) => row.symbol === 'USDT')?.amount ?? '';
        setWalletUsdt(owned);
        setWalletUsdtFailed(owned === '');
        const spend = floorText(value, 6);
        if (!owned || Number(spend) > Number(owned) + 1e-9) {
          setAmount(owned && Number(owned) > 0 ? floorText(Number(owned), 6) : '');
          setError(`Only ${owned || '0'} USDT is in this wallet.`);
          return;
        }
        const dest = usdtDeposit || await safeDepositAddress(creds, 'usdt', USDT_ETH.blockchainKey);
        setUsdtDeposit(dest);
        if (dest.toLowerCase() === ethAddress.toLowerCase()) {
          throw new Error('That deposit address is this wallet.');
        }
        const sent = await sendEthAsset('USDT', dest, spend);
        setAmount('');
        const after = await readEthereumHoldings(ethAddress);
        const left = after.find((row) => row.symbol === 'USDT')?.amount ?? '';
        setWalletUsdt(left);
        setWalletUsdtFailed(left === '');
        setNotice(`Sent ${spend} USDT to SafeTrade. Tx ${sent.hash}. SafeTrade credits it after about ${usdtConf} Ethereum confirmations.`);
        return;
      }
      if (asset === 'WART') {
        const { creds, rows: live } = await refreshExchange();
        const free = rowOf(live, 'WART');
        if (value > free.available + 1e-9) {
          setAmount(free.available > 0 ? formatBalance(free.available) : '');
          setError(freeMessage('WART', free.available, free.locked));
          return;
        }
        const result = await safeWithdrawWart(creds, {
          amount: value,
          address: wartAddress,
          emailCode,
          otpCode,
        });
        if ('needCode' in result) {
          if (result.clearEmail) setEmailCode('');
          setNotice(result.message);
          void refreshWartBook();
          return;
        }
        await refreshExchange();
        void refreshWartBook();
        setEmailCode('');
        setAmount('');
        setNotice(
          result.txid
            ? `Withdraw ${result.id} ${result.status}. Tx ${result.txid}`
            : `Withdraw ${result.id} submitted${result.status ? ` (${result.status})` : ''}.`,
        );
        return;
      }
      const creds = await loadSafeTradeCredentials();
      if (!creds) throw new Error('Save a SafeTrade API key and secret first.');
      const live = await safeBalances(creds);
      onRows(live);
      const free = rowOf(live, 'USDT');
      if (value > free.available + 1e-9) {
        setAmount(free.available > 0 ? formatBalance(free.available) : '');
        setError(freeMessage('USDT', free.available, free.locked));
        return;
      }
      const result = await safeWithdrawCoin(creds, { ...USDT_ETH, min: usdtMinOut, fee: usdtFee }, {
        amount: value,
        address: ethAddress,
        emailCode,
        otpCode,
      });
      if ('needCode' in result) {
        if (result.clearEmail) setEmailCode('');
        setNotice(result.message);
        void refreshUsdtBook();
        return;
      }
      setEmailCode('');
      setAmount('');
      const next = await safeBalances(creds);
      onRows(next);
      void refreshUsdtBook();
      setNotice(
        result.txid
          ? `USDT withdraw ${result.id} ${result.status}. Tx ${result.txid}`
          : `USDT withdraw ${result.id} submitted${result.status ? ` (${result.status})` : ''}.`,
      );
    } catch (err) {
      setNotice('');
      setError(explainExchangeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const current = ACTIONS.find((item) => item.id === action) ?? ACTIONS[0];
  const title = mode === 'swap' ? 'Swap' : mode === 'deposit' ? `Deposit ${asset}` : `Withdraw ${asset}`;
  const subtitle = mode === 'swap'
    ? current.label
    : mode === 'deposit'
      ? 'This wallet → SafeTrade'
      : 'SafeTrade → this wallet';
  const depositAddress = asset === 'WART' ? wartDeposit : usdtDeposit;
  const book = asset === 'WART' ? wartBook : usdtBook;
  const bookAsset = asset;
  const destination = asset === 'WART' ? wartAddress : ethAddress;
  const waitingUsdt = mode === 'deposit' && asset === 'USDT' && walletUsdt == null && !walletUsdtFailed;
  const ctaDisabled = !rows || busy || payValue == null || Boolean(problem) || waitingUsdt;
  const filledMax = maxAmount();

  const summaryRows: { label: string; value: string }[] = [];
  if (mode === 'swap') {
    summaryRows.push({ label: 'Price', value: price > 0 ? `${lastPrice} USDT` : '…' });
    if (action === 'sell-wart') {
      summaryRows.push({ label: 'Minimum', value: `${WART_USDT_MARKET.minWart} WART` });
    }
  } else if (mode === 'deposit' && asset === 'WART') {
    summaryRows.push(
      { label: 'Minimum', value: `${wartMin} WART` },
      { label: 'Network fee', value: `about ${DEFAULT_FEE} WART` },
      { label: 'Confirms', value: `about ${wartConf}` },
    );
  } else if (mode === 'deposit') {
    summaryRows.push(
      { label: 'Minimum', value: `${usdtMinIn} USDT` },
      { label: 'Network fee', value: 'ETH for gas' },
      { label: 'Confirms', value: `about ${usdtConf}` },
    );
  } else if (asset === 'WART') {
    summaryRows.push(
      { label: 'Minimum', value: `${WART_WITHDRAW.min} WART` },
      { label: 'Fee', value: `${WART_WITHDRAW.fee} WART` },
    );
  } else {
    summaryRows.push(
      { label: 'Minimum', value: `${usdtMinOut} USDT` },
      { label: 'Fee', value: `${usdtFee} USDT` },
    );
  }

  return (
    <View style={styles.swapCard}>
      <View style={styles.cardHeader}>
        <View style={styles.headerText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{subtitle}</Text>
        </View>
        <View style={styles.priceBlock}>
          <Text style={styles.spotLabel}>PRICE</Text>
          <Text style={styles.spotValue}>
            {price > 0 ? lastPrice : '…'} <Text style={styles.mutedLabel}>USDT</Text>
          </Text>
        </View>
      </View>

      <View>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => setMenuOpen((open) => !open)}
          accessibilityLabel="SafeTrade action"
          accessibilityState={{ expanded: menuOpen }}
        >
          <Text style={styles.menuLabel}>{current.label}</Text>
          <Text style={styles.menuChevron}>{menuOpen ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {menuOpen ? (
          <View style={styles.menuList}>
            {(['Swap', 'Move'] as const).map((group) => (
              <View key={group}>
                <Text style={styles.menuGroup}>{group}</Text>
                {ACTIONS.filter((item) => item.group === group).map((item) => {
                  const selected = item.id === action;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.menuItem, selected && styles.menuItemOn]}
                      onPress={() => chooseAction(item.id)}
                      accessibilityLabel={`SafeTrade ${item.label}`}
                    >
                      <Text style={[styles.menuItemText, selected && styles.menuItemTextOn]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <Text style={styles.mutedLabel}>You pay</Text>
          <TouchableOpacity onPress={() => filledMax && setAmount(filledMax)} disabled={!filledMax || busy}>
            <Text style={styles.balanceHint}>
              Available {available.text} {available.unit} {available.where}
            </Text>
            {available.locked ? (
              <Text style={styles.lockedHint}>Locked {available.locked}</Text>
            ) : null}
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
          <TokenPill ticker={payAsset} />
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
            {mode === 'swap'
              ? 'Estimate · before the trading fee'
              : mode === 'deposit'
                ? 'On SafeTrade'
                : 'In this wallet · after the fee'}
          </Text>
        </View>
        <View style={styles.amountRow}>
          <Text style={styles.amountInput}>{receiveText}</Text>
          <TokenPill ticker={receiveAsset} />
        </View>
      </View>

      <View style={styles.summary}>
        {summaryRows.map((row) => (
          <View key={row.label} style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>{row.label}</Text>
            <Text style={styles.summaryValue}>{row.value}</Text>
          </View>
        ))}
        {mode === 'deposit' ? (
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
        {mode === 'withdraw' ? (
          <>
            <Text style={styles.summaryValue}>{destination || 'This wallet has no address for this coin.'}</Text>
            <Text style={styles.bookLine}>{bookLine(book, bookAsset, rows, destination)}</Text>
          </>
        ) : null}
      </View>

      {mode === 'withdraw' ? (
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
            editable={!busy}
          />
          <Text style={styles.mutedLabel}>2FA code</Text>
          <TextInput
            style={styles.codeInput}
            value={otpCode}
            onChangeText={setOtpCode}
            placeholder="Authenticator code"
            placeholderTextColor="#3f3f46"
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
        onPress={() => void submit()}
        disabled={ctaDisabled}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#e4e4e7" />
        ) : (
          <Text style={styles.ctaText}>{current.label}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

function bookLine(book: Book, asset: Asset, rows: SpotBalance[] | null, destination: string): string {
  if (book === 'saved') return `On the SafeTrade ${asset} withdraw list. The next withdraw needs only the 2FA code.`;
  if (book === 'pending') return 'Saved on SafeTrade, still waiting to become active.';
  if (book === 'missing') {
    return `Not on the SafeTrade ${asset} withdraw list yet. The first withdraw emails a code and needs the 2FA code.`;
  }
  if (book === 'error') return `Could not read the SafeTrade ${asset} withdraw list.`;
  if (rows && destination) return `Checking the SafeTrade ${asset} withdraw list…`;
  return '';
}

function TokenPill({ ticker }: { ticker: Asset }) {
  return (
    <View style={styles.tokenPill}>
      <TokenIcon symbol={ticker} size={22} />
      <Text style={styles.tokenPillText}>{ticker}</Text>
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
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: '#f4f4f5',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardSub: {
    color: '#52525b',
    fontSize: 11,
  },
  priceBlock: {
    alignItems: 'flex-end',
  },
  spotLabel: {
    color: '#52525b',
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  spotValue: {
    color: '#d4d4d8',
    fontSize: 11,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(63, 63, 70, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.75)',
  },
  chipOff: {
    opacity: 0.4,
  },
  chipText: {
    color: '#e4e4e7',
    fontSize: 11,
    fontWeight: '600',
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(9, 9, 11, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(253, 185, 19, 0.45)',
  },
  menuLabel: {
    color: '#fafafa',
    fontSize: 14,
    fontWeight: '600',
  },
  menuChevron: {
    color: defiColors.gold,
    fontSize: 12,
    marginLeft: 8,
  },
  menuList: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(63, 63, 70, 0.9)',
    backgroundColor: 'rgba(9, 9, 11, 0.92)',
    overflow: 'hidden',
  },
  menuGroup: {
    color: '#71717a',
    fontSize: 10,
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemOn: {
    backgroundColor: 'rgba(253, 185, 19, 0.12)',
  },
  menuItemText: {
    color: '#e4e4e7',
    fontSize: 14,
  },
  menuItemTextOn: {
    color: defiColors.gold,
    fontWeight: '600',
  },
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.95)',
    backgroundColor: 'rgba(24, 24, 27, 0.55)',
    padding: 12,
  },
  mutedLabel: {
    color: '#71717a',
    fontSize: 11,
    marginBottom: 6,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    padding: 0,
  },
  tokenPill: {
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
  tokenPillText: {
    color: '#fafafa',
    fontSize: 13,
    fontWeight: '600',
  },
  flipWrap: {
    alignItems: 'center',
    marginVertical: -10,
    zIndex: 2,
  },
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
  flipMark: {
    color: '#a1a1aa',
    fontSize: 16,
  },
  balanceHint: {
    color: '#71717a',
    fontSize: 10,
    textAlign: 'right',
  },
  lockedHint: {
    color: defiColors.amberText,
    fontSize: 10,
    textAlign: 'right',
  },
  summary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.8)',
    backgroundColor: 'rgba(9, 9, 11, 0.45)',
    padding: 10,
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryValue: {
    color: '#d4d4d8',
    fontSize: 11,
  },
  copyLink: {
    color: defiColors.goldHover,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  bookLine: {
    color: defiColors.gold,
    fontSize: 11,
    lineHeight: 16,
  },
  codeInput: {
    color: '#fff',
    fontSize: 16,
    padding: 0,
    marginBottom: 8,
  },
  hint: {
    textAlign: 'center',
    color: '#a1a1aa',
    fontSize: 11,
    lineHeight: 16,
  },
  notice: {
    color: defiColors.gold,
    fontSize: 12,
    lineHeight: 16,
  },
  warn: {
    color: '#f87171',
    fontSize: 12,
    lineHeight: 16,
  },
  cta: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(39, 39, 42, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.65)',
    alignItems: 'center',
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaText: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default SafeTradeCard;
