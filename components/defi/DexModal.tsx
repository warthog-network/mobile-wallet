/**
 * Uniswap-style swap interface adapted from wartbunker DexPage.
 * Market | Limit | Pool — market = LIMIT_SWAP at spot ± slippage.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { defiStyles, defiColors } from './defiStyles';
import DefiModalShell from './DefiModalShell';
import {
  amountExceedsAvailable,
  formatBalanceBreakdown,
  insufficientFreeBalanceMessage,
  isValidAssetHash,
  normalizeAssetHash,
} from '../../utils/warthogFormat';
import {
  computePoolSpotPrice,
  fetchAssetBalanceForAddress,
  fetchDexMarket,
  fetchLiquidityBalance,
} from '../../utils/defiApi';
import { createWarthogApi } from '../../utils/api';
import {
  submitLimitSwap,
  submitLiquidityDeposit,
  submitLiquidityWithdraw,
} from '../../utils/defiSubmit';
import { DEFAULT_FEE } from '../../constants';
import type { AssetBalance, DexPoolPrefill, WalletData } from '../../types';
import { theme } from '../../theme';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { toast } from '../../utils/toast';
import AssetMark, { AssetTitle } from './AssetMark';
import {
  assetDisplayTicker,
  useAssetMetadata,
  ZERO_ASSET_HASH,
} from '../../utils/assetMetadata';
import { isLedgerSession } from '../../utils/sessionVault';
import { LEDGER_DEFI_HOLD } from '../../utils/ledger/protocol';

interface Props {
  visible: boolean;
  onClose: () => void;
  wallet: WalletData;
  selectedNode: string;
  nextNonce: number;
  poolPrefill: DexPoolPrefill | null;
  onPrefillConsumed: () => void;
  onSuccess: (nonce: number) => Promise<void>;
  /** Tracked asset balances for token picker. */
  assetBalances?: AssetBalance[];
  wartAvailable?: string;
  wartLocked?: string;
  wartTotal?: string;
  /** Inline on overview (no overlay). */
  embedded?: boolean;
  /** Limit which DEX modes are shown. Omit to show Market · Limit · Pool. */
  allowedModes?: OrderMode[];
  /** Home square asked for Market or Pool. Cleared after it is applied. */
  requestedMode?: OrderMode | null;
  onRequestedMode?: () => void;
}

type OrderMode = 'market' | 'limit' | 'pool';

type TokenOption = {
  hash: string;
  symbol: string;
  name: string;
  decimals: number;
  available: string;
  locked: string;
  total: string;
};

type PaySpendable = {
  available: string;
  locked: string;
  total: string;
  unit: string;
  hasLocked: boolean;
  decimals?: number;
};

const DEFAULT_MARKET_SLIPPAGE_PCT = 5;

const formatSpot = (price: number | null, maxDecimals = 8): string => {
  if (price == null || !Number.isFinite(price) || price <= 0) return '—';
  if (price >= 1) return price.toPrecision(6);
  if (price >= 0.0001) return price.toFixed(Math.min(maxDecimals, 8));
  return price.toExponential(4);
};

const formatEstimate = (n: number | null): string => {
  if (n == null || !Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1) return n.toPrecision(6);
  if (n >= 1e-6) return n.toFixed(8).replace(/\.?0+$/, '');
  return n.toExponential(4);
};

const DexModal: React.FC<Props> = ({
  visible,
  onClose,
  wallet,
  selectedNode,
  nextNonce,
  poolPrefill,
  onPrefillConsumed,
  onSuccess,
  assetBalances = [],
  wartAvailable,
  wartLocked,
  wartTotal,
  embedded = false,
  allowedModes,
  requestedMode,
  onRequestedMode,
}) => {
  const modesKey = (allowedModes?.length ? allowedModes : ['market', 'limit', 'pool']).join(',');
  const modes = useMemo<OrderMode[]>(
    () => (modesKey.split(',') as OrderMode[]),
    [modesKey],
  );
  const [orderMode, setOrderMode] = useState<OrderMode>(modes[0] || 'market');
  const isLive = embedded || visible;
  const [payingWart, setPayingWart] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<TokenOption | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [slippagePct, setSlippagePct] = useState(String(DEFAULT_MARKET_SLIPPAGE_PCT));
  const [fee, setFee] = useState(DEFAULT_FEE);
  const [manualNonce, setManualNonce] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [manualHashInput, setManualHashInput] = useState('');
  const [assetDecimals, setAssetDecimals] = useState(8);
  const [swapConfirm, setSwapConfirm] = useState(false);
  const swapFlow = useSpendFlow();

  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const [marketData, setMarketData] = useState<Record<string, unknown> | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [lpBalance, setLpBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [paySpendable, setPaySpendable] = useState<PaySpendable | null>(null);
  const [liqMode, setLiqMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [lpAssetAmt, setLpAssetAmt] = useState('');
  const [lpWartAmt, setLpWartAmt] = useState('');
  const [lpShares, setLpShares] = useState('');

  const tokenOptions = useMemo<TokenOption[]>(() => {
    return (assetBalances || [])
      .map((a) => ({
        hash: normalizeAssetHash(a.hash),
        symbol: a.name || 'TOKEN',
        name: a.name || 'Asset',
        decimals: a.decimals ?? 8,
        available: a.available ?? a.balance ?? '0',
        locked: a.locked ?? '0',
        total: a.balance ?? a.available ?? '0',
      }))
      .filter((t) => t.hash && t.hash.length === 64);
  }, [assetBalances]);

  const assetHash = selectedAsset?.hash || '';

  const loadMarket = useCallback(
    async (hashInput: string) => {
      const hash = normalizeAssetHash(hashInput);
      if (!isValidAssetHash(hash)) {
        setSpotPrice(null);
        setMarketData(null);
        setLpBalance(null);
        return null;
      }
      setMarketLoading(true);
      try {
        const [market, lp] = await Promise.all([
          fetchDexMarket(selectedNode, hash),
          fetchLiquidityBalance(selectedNode, wallet.address, hash),
        ]);
        const m = market as Record<string, unknown>;
        setMarketData(m);
        const spot = computePoolSpotPrice(m);
        setSpotPrice(spot);
        const asset = (m?.baseAsset || m?.asset || {}) as {
          name?: string;
          decimals?: number;
        };
        const decimals = asset.decimals ?? 8;
        setAssetDecimals(decimals);
        if (lp) {
          setLpBalance(lp.balance);
          setSelectedAsset((prev) =>
            prev && prev.hash === hash
              ? { ...prev, symbol: lp.name, name: lp.name, decimals: lp.decimals }
              : prev
          );
          setAssetDecimals(lp.decimals);
        } else {
          setLpBalance(null);
        }
        if (asset.name) {
          setSelectedAsset((prev) =>
            prev && prev.hash === hash
              ? {
                  ...prev,
                  symbol: String(asset.name),
                  name: String(asset.name),
                  decimals,
                }
              : prev
          );
        }
        return { spot, data: m, decimals };
      } catch (e: any) {
        setSpotPrice(null);
        setMarketData(null);
        setLpBalance(null);
        return null;
      } finally {
        setMarketLoading(false);
      }
    },
    [selectedNode, wallet.address]
  );

  useEffect(() => {
    if (!modes.includes(orderMode)) {
      setOrderMode(modes[0] || 'market');
    }
  }, [modes, orderMode]);

  useEffect(() => {
    if (!isLive || !requestedMode) return;
    if (modes.includes(requestedMode)) setOrderMode(requestedMode);
    onRequestedMode?.();
  }, [isLive, requestedMode, modes, onRequestedMode]);

  // Prefill from overview asset DEX / Manage in DEX
  useEffect(() => {
    if (!isLive || !poolPrefill?.hash) return;
    const hash = normalizeAssetHash(poolPrefill.hash);
    const match = tokenOptions.find((t) => t.hash === hash);
    const nextMode = poolPrefill.mode && modes.includes(poolPrefill.mode)
      ? poolPrefill.mode
      : 'market';
    setSelectedAsset(
      match || {
        hash,
        symbol: poolPrefill.name || 'TOKEN',
        name: poolPrefill.name || 'Asset',
        decimals: 8,
        available: '0',
        locked: '0',
        total: '0',
      }
    );
    setManualHashInput(hash);
    setOrderMode(nextMode);
    if (nextMode === 'pool') setLiqMode('deposit');
    onPrefillConsumed();
    void loadMarket(hash);
  }, [isLive, poolPrefill, onPrefillConsumed, loadMarket, tokenOptions, modes]);

  // Default token when opening without prefill
  useEffect(() => {
    if (!isLive) return;
    if (!selectedAsset && tokenOptions.length > 0) {
      setSelectedAsset(tokenOptions[0]);
      setAssetDecimals(tokenOptions[0].decimals);
      setManualHashInput(tokenOptions[0].hash);
    }
  }, [isLive, selectedAsset, tokenOptions]);

  useEffect(() => {
    if (!isLive || !assetHash) return;
    void loadMarket(assetHash);
  }, [isLive, assetHash, loadMarket]);

  const refreshPaySpendable = useCallback(async (): Promise<PaySpendable | null> => {
    if (!wallet?.address || !selectedNode) {
      setPaySpendable(null);
      return null;
    }
    try {
      if (payingWart) {
        if (wartAvailable != null) {
          const info: PaySpendable = {
            available: wartAvailable,
            locked: wartLocked || '0',
            total: wartTotal || wartAvailable,
            unit: 'WART',
            hasLocked: parseFloat(wartLocked || '0') > 0,
            decimals: 8,
          };
          setPaySpendable(info);
          return info;
        }
        const api = createWarthogApi(selectedNode);
        const res = await api.getAccountWartBalance(wallet.address);
        if (!res.success) throw new Error(res.error || 'Failed to fetch WART balance');
        const data = res.data as { wart?: unknown };
        const breakdown = formatBalanceBreakdown(data?.wart, { kind: 'wart' });
        const info: PaySpendable = {
          available: breakdown.available,
          locked: breakdown.locked,
          total: breakdown.total,
          unit: 'WART',
          hasLocked: breakdown.hasLocked,
          decimals: 8,
        };
        setPaySpendable(info);
        return info;
      }

      if (!isValidAssetHash(assetHash)) {
        setPaySpendable(null);
        return null;
      }
      const bal = await fetchAssetBalanceForAddress(
        selectedNode,
        wallet.address,
        assetHash,
        selectedAsset?.symbol
      );
      const info: PaySpendable = {
        available: bal.available,
        locked: bal.locked,
        total: bal.balance,
        unit: bal.name || selectedAsset?.symbol || 'asset',
        hasLocked: Boolean(bal.hasLocked),
        decimals: bal.decimals,
      };
      setPaySpendable(info);
      if (bal.decimals != null) setAssetDecimals(bal.decimals);
      return info;
    } catch {
      const match = tokenOptions.find((t) => t.hash === assetHash);
      if (match && !payingWart) {
        const info: PaySpendable = {
          available: match.available,
          locked: match.locked,
          total: match.total,
          unit: match.symbol,
          hasLocked: parseFloat(match.locked || '0') > 0,
          decimals: match.decimals,
        };
        setPaySpendable(info);
        return info;
      }
      setPaySpendable(null);
      return null;
    }
  }, [
    wallet?.address,
    selectedNode,
    payingWart,
    wartAvailable,
    wartLocked,
    wartTotal,
    assetHash,
    selectedAsset,
    tokenOptions,
  ]);

  useEffect(() => {
    if (!isLive || orderMode === 'pool') return;
    const t = setTimeout(() => {
      void refreshPaySpendable();
    }, 200);
    return () => clearTimeout(t);
  }, [isLive, orderMode, refreshPaySpendable]);

  const displayPayAvailable = useMemo(() => {
    if (paySpendable) return paySpendable;
    if (payingWart && wartAvailable != null) {
      return {
        available: wartAvailable,
        locked: wartLocked || '0',
        total: wartTotal || wartAvailable,
        unit: 'WART',
        hasLocked: parseFloat(wartLocked || '0') > 0,
      } as PaySpendable;
    }
    const match = tokenOptions.find((t) => t.hash === assetHash);
    if (match && !payingWart) {
      return {
        available: match.available,
        locked: match.locked,
        total: match.total,
        unit: match.symbol,
        hasLocked: parseFloat(match.locked || '0') > 0,
      } as PaySpendable;
    }
    return null;
  }, [paySpendable, payingWart, wartAvailable, wartLocked, wartTotal, tokenOptions, assetHash]);

  const effectiveLimitPrice = useMemo(() => {
    if (orderMode === 'limit') {
      const p = parseFloat(String(limitPrice).replace(',', '.'));
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    if (spotPrice == null || spotPrice <= 0) return null;
    const slip =
      Math.max(0, Math.min(50, parseFloat(slippagePct) || DEFAULT_MARKET_SLIPPAGE_PCT)) / 100;
    return payingWart ? spotPrice * (1 + slip) : spotPrice * (1 - slip);
  }, [orderMode, limitPrice, spotPrice, slippagePct, payingWart]);

  const receiveEstimate = useMemo(() => {
    const amt = parseFloat(String(payAmount).replace(',', '.'));
    if (
      !Number.isFinite(amt) ||
      amt <= 0 ||
      effectiveLimitPrice == null ||
      effectiveLimitPrice <= 0
    ) {
      return null;
    }
    if (payingWart) return amt / effectiveLimitPrice;
    return amt * effectiveLimitPrice;
  }, [payAmount, effectiveLimitPrice, payingWart]);

  const getNonce = () => (manualNonce ? parseInt(manualNonce, 10) : nextNonce);

  const fillMax = async () => {
    const info = paySpendable || (await refreshPaySpendable());
    if (!info) {
      toast.error(
        'Balance',
        payingWart ? 'Could not load available WART' : 'Select an asset and load balance first'
      );
      return;
    }
    setPayAmount(info.available);
  };

  const flipDirection = () => {
    setPayingWart((v) => !v);
    setPayAmount('');
  };

  const selectToken = (token: TokenOption) => {
    setSelectedAsset(token);
    setAssetDecimals(token.decimals ?? 8);
    setManualHashInput(token.hash);
    setShowTokenPicker(false);
  };

  const applyManualHash = () => {
    const hash = normalizeAssetHash(manualHashInput);
    if (!isValidAssetHash(hash)) {
      toast.error('Invalid hash', 'Asset hash must be 64 hex characters');
      return;
    }
    const match = tokenOptions.find((t) => t.hash === hash);
    setSelectedAsset(
      match || {
        hash,
        symbol: hash.slice(0, 4).toUpperCase(),
        name: 'Asset',
        decimals: assetDecimals || 8,
        available: '0',
        locked: '0',
        total: '0',
      }
    );
    setShowTokenPicker(false);
  };

  const handleSwap = async (confirmed = false) => {
    if (!assetHash || !isValidAssetHash(assetHash)) {
      toast.error('Select token', 'Select a token to swap');
      return;
    }
    const amountStr = String(payAmount).trim().replace(',', '.');
    if (!amountStr || parseFloat(amountStr) <= 0) {
      toast.error('Amount', 'Enter an amount');
      return;
    }
    if (!confirmed) {
      setSwapConfirm(true);
      return;
    }

    let priceForEncode = effectiveLimitPrice;
    if (orderMode === 'limit') {
      const p = parseFloat(String(limitPrice).replace(',', '.'));
      if (!Number.isFinite(p) || p <= 0) {
        swapFlow.finish(false, 'Limit price', 'Enter a valid limit price (WART per token)');
        return;
      }
      priceForEncode = p;
    } else if (priceForEncode == null) {
      const m = await loadMarket(assetHash);
      if (!m?.spot) {
        swapFlow.finish(false, 'No pool price', 'Cannot place a market order without a pool spot price. Try Limit instead.');
        return;
      }
      const slip =
        Math.max(0, Math.min(50, parseFloat(slippagePct) || DEFAULT_MARKET_SLIPPAGE_PCT)) / 100;
      priceForEncode = payingWart ? m.spot * (1 + slip) : m.spot * (1 - slip);
    }

    setLoading(true);
    swapFlow.begin(orderMode === 'market' ? 'Submitting the market swap…' : 'Placing the limit order…');
    try {
      const spendable = await refreshPaySpendable();
      let decimalsNum = assetDecimals || 8;
      if (spendable) {
        if (!payingWart && spendable.decimals != null) {
          decimalsNum = spendable.decimals;
        }
        if (amountExceedsAvailable(amountStr, spendable.available)) {
          setPayAmount(spendable.available);
          swapFlow.finish(false, 'Insufficient free balance', insufficientFreeBalanceMessage({
            available: spendable.available,
            locked: spendable.locked,
            unit: spendable.unit,
          }));
          return;
        }
      }

      const result = await submitLimitSwap({
        node: selectedNode,
        wallet,
        nonceId: getNonce(),
        fee,
        assetHash,
        isBuy: payingWart,
        amount: amountStr,
        assetDecimals: decimalsNum,
        limitPrice: String(priceForEncode),
        encodeCeil: payingWart,
      });

      await onSuccess(result.nonce + 1);
      const label =
        orderMode === 'market'
          ? payingWart
            ? 'Market buy submitted'
            : 'Market sell submitted'
          : payingWart
            ? 'Limit buy placed'
            : 'Limit sell placed';
      const detail = orderMode === 'market'
        ? `${label}. ${result.txHash.slice(0, 16)}…`
        : `${label}. Locked until it fills. ${result.txHash.slice(0, 16)}…`;
      swapFlow.finish(true, 'Submitted', detail);
      void refreshPaySpendable();
      void loadMarket(assetHash);
    } catch (e: any) {
      let message = e.message || 'Failed';
      if (/insufficient\s+(token\s+)?balance/i.test(message)) {
        const spendable = paySpendable || (await refreshPaySpendable());
        if (spendable) {
          message = insufficientFreeBalanceMessage({
            available: spendable.available,
            locked: spendable.locked,
            unit: spendable.unit,
          });
        }
      }
      swapFlow.finish(false, 'Swap failed', message);
    } finally {
      setLoading(false);
    }
  };

  const handleLiquidity = async () => {
    if (!isValidAssetHash(assetHash)) {
      toast.error('Token', 'Select a pool token');
      return;
    }
    setLoading(true);
    const toastId = toast.loading(
      liqMode === 'deposit' ? 'Depositing liquidity' : 'Withdrawing liquidity',
      'Submitting the transaction…',
    );
    try {
      let result;
      if (liqMode === 'deposit') {
        if (!lpAssetAmt || !lpWartAmt) throw new Error('Asset and WART amounts required');
        result = await submitLiquidityDeposit({
          node: selectedNode,
          wallet,
          nonceId: getNonce(),
          fee,
          assetHash,
          assetAmount: lpAssetAmt,
          decimals: assetDecimals || 8,
          wartAmount: lpWartAmt,
        });
      } else {
        if (!lpShares) throw new Error('LP shares amount required');
        result = await submitLiquidityWithdraw({
          node: selectedNode,
          wallet,
          nonceId: getNonce(),
          fee,
          assetHash,
          shares: lpShares,
        });
      }
      await onSuccess(result.nonce + 1);
      toast.update(toastId, 'success', 'Submitted', `Liquidity ${liqMode} ${result.txHash.slice(0, 18)}…`, 7000);
      setLpAssetAmt('');
      setLpWartAmt('');
      setLpShares('');
      setManualNonce('');
      void loadMarket(assetHash);
    } catch (e: any) {
      toast.update(toastId, 'error', 'Liquidity failed', e.message || 'Failed', 8000);
    } finally {
      setLoading(false);
    }
  };

  const submitLabel = (() => {
    if (loading) return orderMode === 'market' ? 'Swapping…' : 'Placing order…';
    if (!selectedAsset) return 'Select a token';
    if (!payAmount) return 'Enter an amount';
    if (orderMode === 'limit' && !limitPrice) return 'Enter limit price';
    if (orderMode === 'market' && spotPrice == null && !marketLoading) return 'No pool price';
    if (orderMode === 'market') return payingWart ? 'Buy' : 'Sell';
    return payingWart ? 'Place buy limit' : 'Place sell limit';
  })();

  const ledgerHold = isLedgerSession();
  const ctaBlocked =
    ledgerHold ||
    submitLabel === 'Select a token' ||
    submitLabel === 'Enter an amount' ||
    submitLabel === 'Enter limit price' ||
    submitLabel === 'No pool price';

  const selectedMeta = useAssetMetadata(selectedAsset?.hash);
  const selectedTicker =
    assetDisplayTicker(selectedAsset?.symbol || selectedAsset?.name, selectedMeta) ||
    selectedAsset?.symbol ||
    'token';
  const pairLabel = selectedAsset
    ? payingWart
      ? `WART → ${selectedTicker}`
      : `${selectedTicker} → WART`
    : 'Pick a token';

  const TokenPill = ({
    hash,
    name,
    onPress,
    static: isStatic,
  }: {
    hash?: string;
    name: string;
    onPress?: () => void;
    static?: boolean;
  }) => {
    const meta = useAssetMetadata(hash);
    const ticker = (hash ? assetDisplayTicker(name, meta) : '') || name;
    const mark = hash ? (
      <AssetMark hash={hash} name={name} size="xs" />
    ) : (
      <View style={styles.tokenAvatar}>
        <Text style={styles.tokenAvatarText}>{name[0] || '?'}</Text>
      </View>
    );
    return isStatic ? (
      <View style={styles.tokenPill}>
        {mark}
        <Text style={styles.tokenPillText}>{ticker}</Text>
      </View>
    ) : (
      <TouchableOpacity style={styles.tokenPill} onPress={onPress}>
        {mark}
        <Text style={styles.tokenPillText}>{ticker}</Text>
        <Text style={styles.tokenChevron}>▾</Text>
      </TouchableOpacity>
    );
  };

  return (
    <DefiModalShell
      visible={isLive}
      onClose={onClose}
      title="DEX"
      subtitle="Market · Limit · Pool — swap interface"
      embedded={embedded}
      showClose={!embedded}
    >
      {isLedgerSession() ? <Text style={styles.hint}>{LEDGER_DEFI_HOLD}</Text> : null}
      {/* Mode tabs */}
      {modes.length > 1 ? (
      <View style={styles.modeTabs}>
        {([
          { id: 'market' as const, label: 'Market' },
          { id: 'limit' as const, label: 'Limit' },
          { id: 'pool' as const, label: 'Pool' },
        ] as const)
          .filter((t) => modes.includes(t.id))
          .map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.modeTab, orderMode === t.id && styles.modeTabActive]}
            onPress={() => {
              setOrderMode(t.id);
              if (t.id === 'pool' && assetHash) void loadMarket(assetHash);
            }}
          >
            <Text style={[styles.modeTabText, orderMode === t.id && styles.modeTabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      ) : null}

      {/* Pool */}
      {orderMode === 'pool' && (
        <View style={styles.swapCard}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>Liquidity pool</Text>
              <Text style={styles.cardSub} numberOfLines={1}>
                {selectedAsset
                  ? `${selectedTicker} / WART pool`
                  : 'Pick a token for the pool'}
              </Text>
            </View>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, liqMode === 'deposit' && styles.chipActive]}
                onPress={() => setLiqMode('deposit')}
              >
                <Text style={[styles.chipText, liqMode === 'deposit' && styles.chipTextActive]}>
                  Deposit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, liqMode === 'withdraw' && styles.chipActive]}
                onPress={() => setLiqMode('withdraw')}
              >
                <Text style={[styles.chipText, liqMode === 'withdraw' && styles.chipTextActive]}>
                  Withdraw
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedLabel}>Pool token</Text>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => void loadMarket(assetHash || manualHashInput)}
                disabled={marketLoading}
              >
                <Text style={styles.chipText}>{marketLoading ? 'Loading…' : 'Load pool'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.amountRow}>
              <TokenPill
                hash={selectedAsset?.hash}
                name={selectedAsset?.symbol || 'Select'}
                onPress={() => setShowTokenPicker(true)}
              />
            </View>
            <TextInput
              style={[defiStyles.input, { marginTop: 8, fontFamily: theme.typography.fontFamily.mono, fontSize: 12 }]}
              value={manualHashInput}
              onChangeText={setManualHashInput}
              onEndEditing={applyManualHash}
              placeholder="Or paste 64-char asset hash"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
            />
            {lpBalance != null && (
              <Text style={[styles.mutedLabel, { marginTop: 8 }]}>
                Your LP shares:{' '}
                <Text style={{ color: defiColors.amberText }}>{lpBalance}</Text>
              </Text>
            )}
            {spotPrice != null && (
              <Text style={[styles.mutedLabel, { marginTop: 4 }]}>
                Spot: <Text style={{ color: defiColors.textSecondary }}>{formatSpot(spotPrice)}</Text> WART
              </Text>
            )}
          </View>

          {liqMode === 'deposit' ? (
            <>
              <View style={styles.panel}>
                <Text style={styles.mutedLabel}>You deposit · {selectedTicker === 'token' ? 'Asset' : selectedTicker}</Text>
                <View style={styles.amountRow}>
                  <TextInput
                    style={styles.amountInput}
                    value={lpAssetAmt}
                    onChangeText={setLpAssetAmt}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="#3f3f46"
                  />
                  <TokenPill
                    hash={selectedAsset?.hash}
                    name={selectedAsset?.symbol || 'Select'}
                    onPress={() => setShowTokenPicker(true)}
                  />
                </View>
              </View>
              <View style={styles.flipWrap}>
                <View style={styles.flipBtn}>
                  <Text style={{ color: defiColors.textMuted, fontWeight: '600' }}>+</Text>
                </View>
              </View>
              <View style={styles.panel}>
                <Text style={styles.mutedLabel}>You deposit · WART</Text>
                <View style={styles.amountRow}>
                  <TextInput
                    style={styles.amountInput}
                    value={lpWartAmt}
                    onChangeText={setLpWartAmt}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="#3f3f46"
                  />
                  <TokenPill hash={ZERO_ASSET_HASH} name="WART" static />
                </View>
              </View>
              <TouchableOpacity
                style={[styles.cta, (loading || !assetHash || ledgerHold) && styles.ctaDisabled]}
                onPress={() => void handleLiquidity()}
                disabled={loading || !assetHash || ledgerHold}
              >
                <Text style={styles.ctaText}>{loading ? 'Depositing…' : 'Deposit liquidity'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.panel}>
                <View style={styles.rowBetween}>
                  <Text style={styles.mutedLabel}>LP shares to redeem</Text>
                  {lpBalance ? (
                    <TouchableOpacity style={styles.chip} onPress={() => setLpShares(lpBalance)}>
                      <Text style={styles.chipText}>Fill</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={styles.amountRow}>
                  <TextInput
                    style={styles.amountInput}
                    value={lpShares}
                    onChangeText={setLpShares}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="#3f3f46"
                  />
                  <TokenPill name="LP" static />
                </View>
              </View>
              <TouchableOpacity
                style={[styles.cta, (loading || !assetHash || ledgerHold) && styles.ctaDisabled]}
                onPress={() => void handleLiquidity()}
                disabled={loading || !assetHash || ledgerHold}
              >
                <Text style={styles.ctaText}>{loading ? 'Withdrawing…' : 'Withdraw liquidity'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Market / Limit */}
      {orderMode !== 'pool' && (
        <View style={styles.swapCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>
                {orderMode === 'market' ? 'Swap' : 'Limit order'}
              </Text>
              <Text style={styles.cardSub}>{pairLabel}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {spotPrice != null ? (
                <>
                  <Text style={styles.spotLabel}>SPOT</Text>
                  <Text style={styles.spotValue}>
                    {formatSpot(spotPrice)} <Text style={styles.mutedLabel}>WART</Text>
                  </Text>
                </>
              ) : marketLoading ? (
                <Text style={styles.mutedLabel}>Loading…</Text>
              ) : selectedAsset ? (
                <Text style={styles.mutedLabel}>No pool price</Text>
              ) : null}
            </View>
          </View>

          {!selectedAsset && (
            <View style={styles.emptyBanner}>
              <Text style={styles.emptyBannerText}>
                No tracked tokens yet. Add assets under Assets, then pick one here.
              </Text>
            </View>
          )}

          {/* You pay */}
          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedLabel}>You pay</Text>
              {displayPayAvailable ? (
                <TouchableOpacity onPress={() => void fillMax()}>
                  <Text style={styles.balanceHint}>
                    Available{' '}
                    <Text style={{ color: defiColors.textSecondary }}>
                      {displayPayAvailable.available}
                    </Text>{' '}
                    {displayPayAvailable.unit}
                  </Text>
                  {displayPayAvailable.hasLocked ? (
                    <Text style={[styles.balanceHint, { color: defiColors.amberText }]}>
                      Locked {displayPayAvailable.locked}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.amountRow}>
              <TextInput
                style={styles.amountInput}
                value={payAmount}
                onChangeText={setPayAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#3f3f46"
              />
              <TouchableOpacity style={styles.chip} onPress={() => void fillMax()}>
                <Text style={styles.chipText}>MAX</Text>
              </TouchableOpacity>
              {payingWart ? (
                <TokenPill hash={ZERO_ASSET_HASH} name="WART" static />
              ) : (
                <TokenPill
                  hash={selectedAsset?.hash}
                  name={selectedAsset?.symbol || 'Select'}
                  onPress={() => setShowTokenPicker(true)}
                />
              )}
            </View>
          </View>

          {/* Flip */}
          <View style={styles.flipWrap}>
            <TouchableOpacity style={styles.flipBtn} onPress={flipDirection}>
              <Text style={{ color: defiColors.textSecondary, fontSize: 16 }}>⇅</Text>
            </TouchableOpacity>
          </View>

          {/* You receive */}
          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedLabel}>You receive</Text>
              {orderMode === 'market' ? (
                <Text style={styles.balanceHint}>Estimate · {slippagePct}% slip</Text>
              ) : limitPrice ? (
                <Text style={styles.balanceHint}>At your limit</Text>
              ) : null}
            </View>
            <View style={styles.amountRow}>
              <Text style={[styles.amountInput, { paddingVertical: 8 }]}>
                {receiveEstimate != null ? formatEstimate(receiveEstimate) : '0'}
              </Text>
              {!payingWart ? (
                <TokenPill hash={ZERO_ASSET_HASH} name="WART" static />
              ) : (
                <TokenPill
                  hash={selectedAsset?.hash}
                  name={selectedAsset?.symbol || 'Select'}
                  onPress={() => setShowTokenPicker(true)}
                />
              )}
            </View>
          </View>

          {orderMode === 'limit' && (
            <View style={styles.panel}>
              <Text style={styles.mutedLabel}>
                Limit price (WART per {selectedTicker})
              </Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  value={limitPrice}
                  onChangeText={setLimitPrice}
                  keyboardType="decimal-pad"
                  placeholder={spotPrice != null ? formatSpot(spotPrice) : '0.0'}
                  placeholderTextColor="#3f3f46"
                />
                {spotPrice != null && (
                  <TouchableOpacity
                    style={styles.chip}
                    onPress={() => setLimitPrice(String(spotPrice))}
                  >
                    <Text style={styles.chipText}>Use spot</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <View style={styles.summary}>
            {orderMode === 'market' && effectiveLimitPrice != null && (
              <View style={styles.summaryRow}>
                <Text style={styles.mutedLabel}>Max price (slippage)</Text>
                <Text style={styles.summaryValue}>{formatSpot(effectiveLimitPrice)} WART</Text>
              </View>
            )}
            {orderMode === 'limit' && effectiveLimitPrice != null && (
              <View style={styles.summaryRow}>
                <Text style={styles.mutedLabel}>Your limit</Text>
                <Text style={styles.summaryValue}>
                  {formatSpot(effectiveLimitPrice)} / {selectedTicker}
                </Text>
              </View>
            )}
            <View style={styles.summaryRow}>
              <Text style={styles.mutedLabel}>Network fee</Text>
              <Text style={styles.summaryValue}>{fee} WART</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.cta, (loading || ctaBlocked || !assetHash) && styles.ctaDisabled]}
            onPress={() => void handleSwap(false)}
            disabled={loading || ctaBlocked || !assetHash}
          >
            <Text style={styles.ctaText}>{submitLabel}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.hint}>
        {orderMode === 'market'
          ? 'Market uses pool spot ± slippage so the order can fill right away.'
          : orderMode === 'limit'
            ? 'Limit rests on the book until matched. Locked balance frees when filled or cancelled.'
            : 'Deposit asset + WART to mint LP shares. First deposit creates the pool.'}
      </Text>

      {/* Advanced */}
      <TouchableOpacity
        style={styles.advancedHeader}
        onPress={() => setShowAdvanced((v) => !v)}
      >
        <Text style={styles.advancedTitle}>Advanced</Text>
        <Text style={styles.mutedLabel}>{showAdvanced ? 'Hide' : 'Fee · nonce · slip'}</Text>
      </TouchableOpacity>
      {showAdvanced && (
        <View style={styles.advancedBody}>
          <Text style={defiStyles.label}>Fee (WART)</Text>
          <TextInput
            style={defiStyles.input}
            value={fee}
            onChangeText={setFee}
            keyboardType="decimal-pad"
            placeholderTextColor={theme.colors.textMuted}
          />
          <Text style={defiStyles.label}>Nonce (auto: {nextNonce})</Text>
          <TextInput
            style={defiStyles.input}
            value={manualNonce}
            onChangeText={setManualNonce}
            keyboardType="number-pad"
            placeholder="Optional"
            placeholderTextColor={theme.colors.textMuted}
          />
          {orderMode === 'market' && (
            <>
              <Text style={defiStyles.label}>Slippage (%)</Text>
              <TextInput
                style={defiStyles.input}
                value={slippagePct}
                onChangeText={setSlippagePct}
                keyboardType="decimal-pad"
                placeholderTextColor={theme.colors.textMuted}
              />
              <Text style={styles.mutedLabel}>
                Buy: max = spot × (1 + slip). Sell: min = spot × (1 − slip).
              </Text>
            </>
          )}
          {marketData ? (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.mutedLabel}>
                Pool spot: {formatSpot(spotPrice)} WART · open book loaded
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {loading && (
        <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.md }} />
      )}

      {/* Token picker */}
      <Modal
        visible={showTokenPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTokenPicker(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setShowTokenPicker(false)}>
          <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Select token</Text>
              <TouchableOpacity style={styles.chip} onPress={() => setShowTokenPicker(false)}>
                <Text style={styles.chipText}>Close</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[defiStyles.input, { fontFamily: theme.typography.fontFamily.mono, fontSize: 12 }]}
              value={manualHashInput}
              onChangeText={setManualHashInput}
              placeholder="Paste 64-char asset hash"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
            />
            <TouchableOpacity style={[styles.chip, { alignSelf: 'stretch', marginBottom: 10 }]} onPress={applyManualHash}>
              <Text style={[styles.chipText, { textAlign: 'center' }]}>Use hash</Text>
            </TouchableOpacity>
            <FlatList
              data={tokenOptions}
              keyExtractor={(item) => item.hash}
              style={{ maxHeight: 280 }}
              ListEmptyComponent={
                <Text style={[styles.mutedLabel, { textAlign: 'center', paddingVertical: 24 }]}>
                  No tracked assets. Add tokens under Assets.
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.tokenRow,
                    selectedAsset?.hash === item.hash && styles.tokenRowActive,
                  ]}
                  onPress={() => selectToken(item)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <AssetMark hash={item.hash} name={item.symbol} size="xs" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AssetTitle
                        hash={item.hash}
                        name={item.symbol}
                        style={styles.tokenPillText}
                      />
                      <Text style={styles.hashHint} numberOfLines={1}>
                        {item.hash.slice(0, 12)}…
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.summaryValue}>{item.available}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <SpendConfirm
        open={swapConfirm}
        title="Confirm DEX submit"
        rows={[
          { label: 'Token', value: selectedTicker || assetHash || '—' },
          { label: 'Amount', value: `${payAmount || '—'} ${payingWart ? 'WART' : selectedTicker}` },
          { label: 'Fee', value: `${fee} WART` },
          { label: 'Mode', value: orderMode },
        ]}
        busy={swapFlow.busy || loading}
        step={swapFlow.step}
        outcome={swapFlow.outcome}
        confirmLabel={orderMode === 'market' ? (payingWart ? 'Buy' : 'Sell') : 'Place order'}
        onCancel={() => {
          swapFlow.close(() => {
            setPayAmount('');
            setManualNonce('');
          });
          setSwapConfirm(false);
        }}
        onConfirm={() => void handleSwap(true)}
      />
    </DefiModalShell>
  );
};

const styles = {
  modeTabs: {
    flexDirection: 'row' as const,
    gap: 6,
    padding: 4,
    backgroundColor: 'rgba(9, 9, 11, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.9)',
    borderRadius: 999,
    marginBottom: 12,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.75)',
    backgroundColor: 'rgba(63, 63, 70, 0.55)',
    alignItems: 'center' as const,
  },
  modeTabActive: {
    backgroundColor: 'rgba(253, 185, 19, 0.14)',
    borderColor: 'rgba(253, 185, 19, 0.8)',
  },
  modeTabText: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '500' as const,
  },
  modeTabTextActive: {
    color: defiColors.gold,
  },
  swapCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(231, 147, 0, 0.3)',
    borderTopWidth: 2,
    borderTopColor: defiColors.gold,
    backgroundColor: 'rgba(24, 24, 27, 0.75)',
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(39, 39, 42, 0.5)',
    marginBottom: 4,
  },
  cardTitle: {
    color: '#f4f4f5',
    fontSize: 14,
    fontWeight: '600' as const,
    marginBottom: 2,
  },
  cardSub: {
    color: '#52525b',
    fontSize: 11,
  },
  chipRow: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(63, 63, 70, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.75)',
  },
  chipActive: {
    backgroundColor: 'rgba(253, 185, 19, 0.14)',
    borderColor: 'rgba(253, 185, 19, 0.75)',
  },
  chipText: {
    color: '#e4e4e7',
    fontSize: 11,
    fontWeight: '600' as const,
  },
  chipTextActive: {
    color: defiColors.gold,
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
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
  },
  amountRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    color: '#fff',
    fontSize: 22,
    fontWeight: '600' as const,
    padding: 0,
  },
  tokenPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(9, 9, 11, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(113, 113, 122, 0.9)',
  },
  tokenAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#3f3f46',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tokenAvatarText: {
    color: '#e4e4e7',
    fontSize: 11,
    fontWeight: '700' as const,
  },
  tokenPillText: {
    color: '#fafafa',
    fontSize: 13,
    fontWeight: '600' as const,
  },
  tokenChevron: {
    color: '#71717a',
    fontSize: 11,
  },
  flipWrap: {
    alignItems: 'center' as const,
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
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  balanceHint: {
    color: '#71717a',
    fontSize: 10,
    textAlign: 'right' as const,
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
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  summaryValue: {
    color: '#d4d4d8',
    fontSize: 11,
    fontVariant: ['tabular-nums' as const],
  },
  cta: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(39, 39, 42, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(82, 82, 91, 0.65)',
    alignItems: 'center' as const,
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaText: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600' as const,
  },
  hint: {
    textAlign: 'center' as const,
    color: '#a1a1aa',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  emptyBanner: {
    borderWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: 'rgba(63, 63, 70, 0.85)',
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'rgba(24, 24, 27, 0.4)',
  },
  emptyBannerText: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 16,
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
  advancedHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: defiColors.borderMuted,
  },
  advancedTitle: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '500' as const,
  },
  advancedBody: {
    paddingBottom: 8,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end' as const,
  },
  pickerSheet: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(63, 63, 70, 0.9)',
    padding: 16,
    maxHeight: '70%' as const,
  },
  tokenRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(24, 24, 27, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(39, 39, 42, 0.9)',
    marginBottom: 6,
  },
  tokenRowActive: {
    borderColor: 'rgba(231, 147, 0, 0.45)',
    backgroundColor: 'rgba(231, 147, 0, 0.08)',
  },
  hashHint: {
    color: '#52525b',
    fontSize: 10,
    fontFamily: theme.typography.fontFamily.mono,
  },
};

export default DexModal;
