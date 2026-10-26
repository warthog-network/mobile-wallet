import React, { useState, useRef, useMemo, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, PanResponder, findNodeHandle } from 'react-native';
import { toast } from '../../utils/toast';
import * as Clipboard from 'expo-clipboard';
import FormattedNumber from '../FormattedNumber';
import SpendableBalanceDisplay from '../SpendableBalanceDisplay';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { defiColors, defiStyles } from './defiStyles';
import { isValidAssetHash } from '../../utils/warthogFormat';
import { submitCancelLimitOrder } from '../../utils/defiSubmit';
import { DEFAULT_FEE } from '../../constants';
import type { AssetBalance, LiquidityPosition, OpenLimitOrder, OpenOrdersByAsset, WalletData } from '../../types';
import { theme } from '../../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AssetMark, { AssetTitle } from './AssetMark';
import AssetChartPanel from './AssetChartPanel';

interface Props {
  wallet: WalletData;
  selectedNode: string;
  nextNonce: number;
  orderedAssets: AssetBalance[];
  reorderableAssetCount: number;
  openOrders: OpenOrdersByAsset[] | null;
  liquidityPositions: LiquidityPosition[] | null;
  loadingAssets: boolean;
  loadingOrders: boolean;
  loadingLiquidity: boolean;
  onAddAsset: (hash: string) => Promise<void>;
  onRemoveAsset: (hash: string) => Promise<void>;
  onReorderAssets: (fromIndex: number, toIndex: number) => void;
  onSendAsset: (asset: AssetBalance) => void;
  onOpenDex: (prefill?: { hash: string; name: string; mode?: 'market' | 'limit' | 'pool' }) => void;
  onRefreshOrders: () => Promise<OpenOrdersByAsset[] | null | undefined>;
  onRefreshLiquidity: () => Promise<void>;
  onNonceBump: (nonce: number) => Promise<void>;
  /** Wallet shows assets. Activity shows orders. Liquidity shows positions. */
  part?: 'all' | 'assets' | 'orders' | 'liquidity';
}

type OrderDirection = 'buy' | 'sell';

const DefiOverviewSection: React.FC<Props> = ({
  wallet,
  selectedNode,
  nextNonce,
  orderedAssets,
  reorderableAssetCount,
  openOrders,
  liquidityPositions,
  loadingAssets,
  loadingOrders,
  loadingLiquidity,
  onAddAsset,
  onRemoveAsset,
  onReorderAssets,
  onSendAsset,
  onOpenDex,
  onRefreshOrders,
  onRefreshLiquidity,
  onNonceBump,
  part = 'all',
}) => {
  const [manualHash, setManualHash] = useState('');
  const [adding, setAdding] = useState(false);
  /** Section open state — closed bar matches Your Assets / wartbunker overview */
  const [showAssets, setShowAssets] = useState(true);
  const [openAssetCharts, setOpenAssetCharts] = useState<Set<string>>(new Set());

  useEffect(() => {
    void AsyncStorage.getItem('warthogAssetCharts').then((raw) => {
      if (!raw) return;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setOpenAssetCharts(new Set(arr.map((h: unknown) => String(h).toLowerCase())));
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  const persistAssetCharts = (next: Set<string>) => {
    void AsyncStorage.setItem('warthogAssetCharts', JSON.stringify([...next]));
  };
  const chartKey = (hash: string) => String(hash || '').replace(/^0x/i, '').toLowerCase();
  const toggleAssetChart = (hash: string) => {
    const key = chartKey(hash);
    if (!key) return;
    setOpenAssetCharts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistAssetCharts(next);
      return next;
    });
  };
  const chartOpen = (hash: string) => openAssetCharts.has(chartKey(hash));
  const anyAssetChartsOpen = orderedAssets.some((a) => chartOpen(a.hash));
  const toggleAllAssetCharts = () => {
    const keys = orderedAssets.map((a) => chartKey(a.hash)).filter(Boolean);
    if (!keys.length) return;
    setOpenAssetCharts((prev) => {
      const next = new Set(prev);
      const anyOpen = keys.some((k) => next.has(k));
      if (anyOpen) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      persistAssetCharts(next);
      return next;
    });
  };
  const [showOrders, setShowOrders] = useState(false);
  const [showLiquidity, setShowLiquidity] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [dragAssetIndex, setDragAssetIndex] = useState<number | null>(null);
  const [dropAssetIndex, setDropAssetIndex] = useState<number | null>(null);
  const [ghostTop, setGhostTop] = useState<number | null>(null);
  const cardLayouts = useRef<Record<number, { y: number; height: number }>>({});
  const cardRefs = useRef<Record<number, View | null>>({});
  const dragAssetIndexRef = useRef<number | null>(null);
  const dropAssetIndexRef = useRef<number | null>(null);
  const listRef = useRef<View | null>(null);
  const listWindowYRef = useRef(0);
  const ghostOriginRef = useRef(0);
  const {
    limitOrderBuyStyles,
    limitOrderSellStyles,
    liquidityPoolStyles,
  } = useNumberDisplay();

  const handleAdd = async () => {
    if (!isValidAssetHash(manualHash)) {
      toast.error('Invalid hash', 'Enter a 64-character hex asset hash');
      return;
    }
    setAdding(true);
    try {
      await onAddAsset(manualHash.trim());
      setManualHash('');
      toast.success('Added', 'Asset added to your wallet');
    } catch (e: any) {
      toast.error('Failed', e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleCancel = async (txHash: string) => {
    if (!txHash) return;
    Alert.alert('Cancel order?', 'Submit a cancelation transaction to the node.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Order',
        style: 'destructive',
        onPress: async () => {
          setCancelling(txHash);
          try {
            const result = await submitCancelLimitOrder({
              node: selectedNode,
              wallet,
              nonceId: nextNonce,
              fee: DEFAULT_FEE,
              orderTxHash: txHash,
            });
            await onNonceBump(result.nonce + 1);
            await onRefreshOrders();
            toast.success('Submitted', `Cancel tx: ${result.txHash.slice(0, 16)}…`);
          } catch (e: any) {
            toast.error('Cancel failed', e.message);
          } finally {
            setCancelling(null);
          }
        },
      },
    ]);
  };

  const copyHash = (text: string, label = 'Hash') => {
    Clipboard.setStringAsync(text);
    toast.success('Copied', `${label} copied to clipboard`);
  };

  const orderCount = openOrders?.reduce(
    (sum, g) => sum + (g.wartToAssetSwaps?.length || 0) + (g.assetToWartSwaps?.length || 0),
    0
  ) ?? 0;

  const assetGroupKey = (asset: { hash?: string; id?: number }) =>
    (asset?.hash || String(asset?.id ?? '')).toLowerCase();

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const collapseAllAssetGroups = (orders: OpenOrdersByAsset[]) => {
    setCollapsedGroups(
      new Set(orders.map((group) => assetGroupKey(group.baseAsset)).filter(Boolean))
    );
  };

  const expandAllAssetGroups = () => setCollapsedGroups(new Set());

  const measureListWindow = () => {
    listRef.current?.measureInWindow((_x, y) => {
      listWindowYRef.current = y;
    });
  };

  const measureCardLayout = (index: number) => {
    const ref = cardRefs.current[index];
    if (!ref) return;
    ref.measureInWindow((_x, y, _w, height) => {
      cardLayouts.current[index] = { y, height };
    });
  };

  const findDropIndex = (pageY: number, fallback: number) => {
    let target = fallback;
    const reorderLimit = Math.min(orderedAssets.length, reorderableAssetCount);
    for (let i = 0; i < reorderLimit; i += 1) {
      const layout = cardLayouts.current[i];
      if (layout && pageY >= layout.y && pageY < layout.y + layout.height) {
        target = i;
        break;
      }
    }
    return target;
  };

  const createDragResponder = (index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => reorderableAssetCount > 1 && index < reorderableAssetCount,
      onMoveShouldSetPanResponder: () => reorderableAssetCount > 1 && index < reorderableAssetCount,
      onPanResponderGrant: (evt) => {
        measureListWindow();
        orderedAssets.forEach((_, i) => measureCardLayout(i));
        const layout = cardLayouts.current[index];
        const pageY = evt.nativeEvent.pageY;
        const fallbackTop = (layout?.y ?? pageY) - listWindowYRef.current;
        ghostOriginRef.current = fallbackTop;
        setGhostTop(fallbackTop);
        const card = cardRefs.current[index];
        const listHandle = findNodeHandle(listRef.current);
        if (card && listHandle != null) {
          card.measureLayout(
            listHandle,
            (_x, y) => {
              ghostOriginRef.current = y;
              setGhostTop(y);
            },
            () => undefined,
          );
        }
        dragAssetIndexRef.current = index;
        dropAssetIndexRef.current = index;
        setDragAssetIndex(index);
        setDropAssetIndex(index);
      },
      onPanResponderMove: (evt, gesture) => {
        setGhostTop(ghostOriginRef.current + gesture.dy);
        const pageY = evt.nativeEvent.pageY;
        const target = findDropIndex(pageY, index);
        dropAssetIndexRef.current = target;
        setDropAssetIndex(target);
      },
      onPanResponderRelease: () => {
        const from = dragAssetIndexRef.current;
        const to = dropAssetIndexRef.current;
        if (from !== null && to !== null && from !== to) {
          onReorderAssets(from, to);
        }
        dragAssetIndexRef.current = null;
        dropAssetIndexRef.current = null;
        setDragAssetIndex(null);
        setDropAssetIndex(null);
        setGhostTop(null);
      },
      onPanResponderTerminate: () => {
        dragAssetIndexRef.current = null;
        dropAssetIndexRef.current = null;
        setDragAssetIndex(null);
        setDropAssetIndex(null);
        setGhostTop(null);
      },
    });

  const dragResponders = useMemo(
    () => orderedAssets.map((_, index) => createDragResponder(index)),
    [orderedAssets.length, reorderableAssetCount, onReorderAssets]
  );

  useEffect(() => {
    if (part !== 'orders') return;
    setShowOrders(true);
    void onRefreshOrders();
  }, [part, onRefreshOrders]);

  useEffect(() => {
    if (part !== 'liquidity') return;
    setShowLiquidity(true);
    void onRefreshLiquidity();
  }, [part, onRefreshLiquidity]);

  const handleOpenOrdersView = async () => {
    if (showOrders) return;
    if (!openOrders) {
      const orders = await onRefreshOrders();
      if (orders && orders.length > 0) collapseAllAssetGroups(orders);
    } else if (openOrders.length > 0) {
      collapseAllAssetGroups(openOrders);
    }
    setShowOrders(true);
  };

  const handleOpenOrdersRefresh = async () => {
    const orders = await onRefreshOrders();
    if (orders && orders.length > 0) collapseAllAssetGroups(orders);
  };

  const getFillPct = (amountRaw: string, filledRaw: string) => {
    const amountNum = parseFloat(amountRaw);
    const filledNum = parseFloat(filledRaw);
    if (!Number.isFinite(amountNum) || amountNum <= 0) return 0;
    return Math.min(100, Math.floor((filledNum / amountNum) * 100));
  };

  const renderOrderCard = (
    order: OpenLimitOrder,
    direction: OrderDirection,
    assetName: string,
    key: string
  ) => {
    const amountRaw = order.amount?.str || '0';
    const filledRaw = order.filled?.str || '0';
    const limitValue = order.formattedLimitPrice || order.limit?.doubleAdjusted || '—';
    const fillPct = getFillPct(amountRaw, filledRaw);
    const isBuy = direction === 'buy';
    const orderStyles = isBuy ? limitOrderBuyStyles : limitOrderSellStyles;

    return (
      <View key={key} style={defiStyles.orderCard}>
        <View style={defiStyles.row}>
          <View style={[defiStyles.orderBadge, { backgroundColor: orderStyles.bgMuted }]}>
            <Text style={{ color: orderStyles.text, fontSize: 10, fontWeight: '700' }}>
              {isBuy ? 'BUY' : 'SELL'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={defiStyles.orderLabel}>Limit Price</Text>
            <Text style={defiStyles.orderValue}>
              <FormattedNumber value={limitValue} />{' '}
              <Text style={defiStyles.orderLabel}>WART/{assetName}</Text>
            </Text>
          </View>
        </View>

        <View style={[defiStyles.row, { marginTop: theme.spacing.sm }]}>
          <View>
            <Text style={defiStyles.orderLabel}>Amount</Text>
            <Text style={defiStyles.orderValue}>
              <FormattedNumber value={amountRaw} variant="balance" />{' '}
              <Text style={defiStyles.orderLabel}>{assetName}</Text>
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={defiStyles.orderLabel}>Filled</Text>
            <Text style={defiStyles.orderValue}>
              <FormattedNumber value={filledRaw} variant="balance" />{' '}
              <Text style={defiStyles.orderLabel}>{assetName}</Text>
            </Text>
          </View>
        </View>

        <View style={{ marginTop: theme.spacing.sm }}>
          <View style={defiStyles.row}>
            <Text style={defiStyles.orderLabel}>Fill Progress</Text>
            <Text style={defiStyles.orderLabel}>{fillPct}%</Text>
          </View>
          <View style={defiStyles.progressTrack}>
            <View
              style={[
                { backgroundColor: orderStyles.bgSolid, height: '100%', borderRadius: 4 },
                { width: `${fillPct}%` },
              ]}
            />
          </View>
        </View>

        {order.txHash ? (
          <View style={[defiStyles.orderDivider, defiStyles.row, { justifyContent: 'flex-start' }]}>
            <Text style={defiStyles.orderTxLabel}>Tx</Text>
            <TouchableOpacity onPress={() => copyHash(order.txHash!, 'Transaction hash')}>
              <Text style={defiStyles.orderTxHash}>
                {order.txHash.slice(0, 8)}…{order.txHash.slice(-6)}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {order.txHash ? (
          <View style={{ marginTop: theme.spacing.sm, alignItems: 'flex-end' }}>
            <TouchableOpacity
              style={[defiStyles.compactBtn, defiStyles.btnDanger]}
              onPress={() => handleCancel(order.txHash!)}
              disabled={cancelling === order.txHash || fillPct >= 100}
            >
              <Text style={defiStyles.btnDangerText}>
                {cancelling === order.txHash ? 'Canceling…' : 'Cancel Order'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const renderAssetCard = (asset: AssetBalance, index: number, ghost = false) => (
    <View
      key={ghost ? `ghost-${asset.hash}` : asset.hash}
      ref={ghost ? undefined : (ref) => { cardRefs.current[index] = ref; }}
      onLayout={ghost ? undefined : () => measureCardLayout(index)}
      style={[
        defiStyles.card,
        { flexDirection: 'column', alignItems: 'stretch' },
        !ghost && dragAssetIndex === index && defiStyles.cardDragging,
        !ghost && dropAssetIndex === index && dragAssetIndex !== null && defiStyles.cardDropTarget,
        ghost && defiStyles.cardGhost,
      ]}
    >
      <View style={defiStyles.assetHead}>
        <View style={defiStyles.assetId}>
          {reorderableAssetCount > 1 && index < reorderableAssetCount ? (
            <View
              style={defiStyles.dragHandle}
              {...(ghost ? {} : dragResponders[index]?.panHandlers)}
              accessibilityLabel={`Press and hold to reorder ${asset.name}`}
            >
              <View style={defiStyles.dragDotGrid}>
                {Array.from({ length: 9 }).map((_, dot) => (
                  <View key={dot} style={defiStyles.dragDot} />
                ))}
              </View>
            </View>
          ) : null}
          <AssetMark hash={asset.hash} name={asset.name} />
          <View style={{ flex: 1, minWidth: 0, marginLeft: theme.spacing.sm }}>
            <AssetTitle hash={asset.hash} name={asset.name} style={defiStyles.cardTitle} />
            <TouchableOpacity onPress={() => copyHash(asset.hash, 'Asset hash')} disabled={ghost}>
              <Text style={defiStyles.cardSub}>
                {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={defiStyles.assetAmounts}>
          <SpendableBalanceDisplay
            available={asset.available ?? asset.balance}
            locked={asset.locked}
            total={asset.balance}
            unit={asset.name}
            layout="row"
            primaryStyle={defiStyles.balance}
            unitStyle={defiStyles.balanceUnit}
          />
        </View>
      </View>
      <View style={[defiStyles.row, { marginTop: theme.spacing.sm, flexWrap: 'wrap' }]}>
        <TouchableOpacity
          style={[defiStyles.compactBtn, { flex: 1, minWidth: 90 }]}
          onPress={() => onSendAsset(asset)}
          disabled={ghost}
        >
          <Text style={defiStyles.compactBtnText}>Send Asset</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[defiStyles.compactBtn, { flex: 1, minWidth: 70 }]}
          onPress={() => onOpenDex({ hash: asset.hash, name: asset.name, mode: 'market' })}
          disabled={ghost}
        >
          <Text style={defiStyles.compactBtnText}>DEX</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={defiStyles.compactBtn}
          onPress={() => copyHash(asset.hash, 'Asset hash')}
          disabled={ghost}
        >
          <Text style={defiStyles.compactBtnTextAccent}>Copy Hash</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            defiStyles.compactBtn,
            chartOpen(asset.hash) && defiStyles.compactBtnActive,
          ]}
          onPress={() => toggleAssetChart(asset.hash)}
          disabled={ghost}
        >
          <Text
            style={[
              defiStyles.compactBtnText,
              chartOpen(asset.hash) && defiStyles.compactBtnTextActive,
            ]}
          >
            Chart
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={defiStyles.removeBtn}
          onPress={() => onRemoveAsset(asset.hash)}
          disabled={ghost}
        >
          <Text style={defiStyles.removeBtnText}>×</Text>
        </TouchableOpacity>
      </View>
      {!ghost && chartOpen(asset.hash) ? (
        <View style={{ width: '100%', marginTop: 8 }}>
          <AssetChartPanel
            nodeUrl={selectedNode}
            hash={asset.hash}
            assetName={asset.name}
          />
        </View>
      ) : null}
    </View>
  );

  const showAssetsBlock = part === 'all' || part === 'assets';
  const showOrdersBlock = part === 'all' || part === 'orders';
  const showLiquidityBlock = part === 'all' || part === 'liquidity';

  return (
    <View>
      {showAssetsBlock ? <View style={[defiStyles.section, dragAssetIndex != null && defiStyles.sectionDragging]}>
        <View style={defiStyles.sectionHeaderPressable}>
          <TouchableOpacity
            style={[defiStyles.sectionHeaderLeft, { flex: 1 }]}
            onPress={() => setShowAssets((v) => !v)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAssets }}
          >
            <Text style={defiStyles.sectionChevron}>{showAssets ? '▼' : '▶'}</Text>
            <Text style={[defiStyles.sectionTitle, defiStyles.sectionTitleAssets]}>Your Assets</Text>
            {orderedAssets.length > 0 ? (
              <Text style={[defiStyles.badge, defiStyles.badgeBlue]}>{orderedAssets.length}</Text>
            ) : null}
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {showAssets && orderedAssets.length > 0 ? (
              <TouchableOpacity
                style={[defiStyles.compactBtn, anyAssetChartsOpen && defiStyles.compactBtnActive]}
                onPress={toggleAllAssetCharts}
              >
                <Text
                  style={[
                    defiStyles.compactBtnText,
                    anyAssetChartsOpen && defiStyles.compactBtnTextActive,
                  ]}
                >
                  Charts
                </Text>
              </TouchableOpacity>
            ) : null}
            {reorderableAssetCount > 1 && showAssets ? (
              <Text style={defiStyles.reorderHint}>Hold to reorder</Text>
            ) : null}
          </View>
        </View>
        {showAssets ? (
        <View style={defiStyles.sectionBody}>
          {loadingAssets && orderedAssets.length === 0 ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : orderedAssets.length > 0 ? (
            <View
              ref={listRef}
              collapsable={false}
              onLayout={measureListWindow}
              style={defiStyles.assetDragList}
            >
              {orderedAssets.map((asset, index) => renderAssetCard(asset, index))}
              {dragAssetIndex != null && ghostTop != null && orderedAssets[dragAssetIndex] ? (
                <View
                  pointerEvents="none"
                  style={[defiStyles.cardGhostWrap, { top: ghostTop }]}
                >
                  {renderAssetCard(orderedAssets[dragAssetIndex], dragAssetIndex, true)}
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={defiStyles.emptyText}>No custom tokens tracked yet</Text>
          )}

          <View style={defiStyles.sectionFooter}>
            <TextInput
              style={[defiStyles.input, { marginBottom: theme.spacing.sm }]}
              placeholder="Paste 64-char asset hash to track"
              placeholderTextColor={defiColors.textMuted}
              value={manualHash}
              onChangeText={(t) => setManualHash(t.trim())}
              autoCapitalize="none"
            />
            <TouchableOpacity style={defiStyles.compactBtn} onPress={handleAdd} disabled={adding || !manualHash}>
              <Text style={defiStyles.compactBtnText}>{adding ? 'Adding…' : '+ Add Token'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        ) : null}
      </View> : null}

      {showOrdersBlock ? <View style={defiStyles.section}>
        <TouchableOpacity
          style={defiStyles.sectionHeaderPressable}
          onPress={async () => {
            if (showOrders) {
              setShowOrders(false);
              return;
            }
            await handleOpenOrdersView();
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ expanded: showOrders }}
        >
          <View style={defiStyles.sectionHeaderLeft}>
            <Text style={defiStyles.sectionChevron}>{showOrders ? '▼' : '▶'}</Text>
            <Text style={[defiStyles.sectionTitle, defiStyles.sectionTitleOrders]}>Open Limit Orders</Text>
            {(openOrders?.length ?? 0) > 0 || orderCount > 0 ? (
              <Text style={[defiStyles.badge, defiStyles.badgePurple]}>
                {openOrders?.length ?? 0} asset{(openOrders?.length ?? 0) !== 1 ? 's' : ''}
              </Text>
            ) : loadingOrders ? (
              <Text style={[defiStyles.badge, defiStyles.badgePurple]}>…</Text>
            ) : null}
          </View>
        </TouchableOpacity>
        {showOrders ? (
        <View style={defiStyles.sectionBody}>
          <View style={[defiStyles.row, { flexWrap: 'wrap', justifyContent: 'flex-start', gap: theme.spacing.sm }]}>
            <TouchableOpacity
              style={defiStyles.compactBtn}
              onPress={handleOpenOrdersRefresh}
              disabled={loadingOrders}
            >
              <Text style={defiStyles.compactBtnText}>
                {loadingOrders ? 'Loading Open Orders…' : '⟳ Refresh Open Orders'}
              </Text>
            </TouchableOpacity>
          </View>

          {openOrders && openOrders.length > 1 ? (
            <View style={[defiStyles.row, { justifyContent: 'flex-end', marginTop: theme.spacing.md }]}>
              <TouchableOpacity style={defiStyles.compactBtn} onPress={expandAllAssetGroups}>
                <Text style={defiStyles.compactBtnText}>Show all orders</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={defiStyles.compactBtn}
                onPress={() => collapseAllAssetGroups(openOrders)}
              >
                <Text style={defiStyles.compactBtnText}>Close all orders</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {openOrders && openOrders.length > 0 && openOrders.map((group, idx) => {
            const asset = group.baseAsset;
            const buys = group.wartToAssetSwaps || [];
            const sells = group.assetToWartSwaps || [];
            const key = assetGroupKey(asset);
            const collapsed = collapsedGroups.has(key);
            const totalOrders = buys.length + sells.length;
            const orderCountLabel =
              totalOrders > 0
                ? buys.length > 0 && sells.length > 0
                  ? ` · ${buys.length}B / ${sells.length}S`
                  : buys.length > 0
                    ? ' · buy'
                    : ' · sell'
                : '';

            return (
              <View key={asset.hash || idx} style={defiStyles.orderGroupCard}>
                <View
                  style={[
                    defiStyles.orderGroupHeader,
                    !collapsed && defiStyles.orderGroupHeaderExpanded,
                  ]}
                >
                  <View style={defiStyles.orderGroupHeaderTop}>
                    <TouchableOpacity
                      style={defiStyles.orderGroupHeaderBtn}
                      onPress={() => toggleGroup(key)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !collapsed }}
                    >
                      <Text style={defiStyles.orderGroupChevron}>{collapsed ? '▸' : '▾'}</Text>
                      <View style={[defiStyles.assetAvatar, defiStyles.assetAvatarPurple]}>
                        <Text style={defiStyles.assetAvatarText}>
                          {asset.name?.[0]?.toUpperCase() || '?'}
                        </Text>
                      </View>
                      <Text style={[defiStyles.cardTitle, { flex: 1 }]} numberOfLines={1}>
                        {asset.name}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={defiStyles.compactBtn} onPress={() => toggleGroup(key)}>
                      <Text style={defiStyles.compactBtnText}>{collapsed ? 'Show' : 'Hide'}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={defiStyles.orderMetaRow}>
                    {asset.id != null ? (
                      <View style={defiStyles.orderMetaBadge}>
                        <Text style={defiStyles.orderMetaBadgeText}>ID {asset.id}</Text>
                      </View>
                    ) : null}
                    {asset.decimals != null ? (
                      <View style={defiStyles.orderMetaBadge}>
                        <Text style={defiStyles.orderMetaBadgeText}>{asset.decimals} decimals</Text>
                      </View>
                    ) : null}
                    {totalOrders > 0 ? (
                      <View style={[defiStyles.orderMetaBadge, defiStyles.orderMetaBadgePurple]}>
                        <Text style={defiStyles.orderMetaBadgePurpleText}>
                          {totalOrders} order{totalOrders !== 1 ? 's' : ''}{orderCountLabel}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {asset.hash ? (
                    <TouchableOpacity
                      style={defiStyles.orderGroupHash}
                      onPress={() => copyHash(asset.hash || '', 'Asset hash')}
                    >
                      <Text style={defiStyles.orderGroupHashText}>
                        {asset.hash.slice(0, 8)}…{asset.hash.slice(-6)}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {!collapsed && (
                  <View style={defiStyles.orderGroupBody}>
                    {buys.length > 0 ? (
                      <View>
                        <View style={defiStyles.orderSubsectionHeader}>
                          <View style={[defiStyles.orderSubsectionDot, defiStyles.orderSubsectionDotBuy]} />
                          <Text style={[defiStyles.orderSubsectionTitle, defiStyles.orderSubsectionTitleBuy]}>
                            Buy Orders
                          </Text>
                          <Text style={[defiStyles.orderSubsectionCount, defiStyles.orderSubsectionCountBuy]}>
                            ({buys.length})
                          </Text>
                        </View>
                        {buys.map((order, oi) =>
                          renderOrderCard(order, 'buy', asset.name || 'Asset', `b-${key}-${oi}`)
                        )}
                      </View>
                    ) : null}

                    {sells.length > 0 ? (
                      <View>
                        <View style={defiStyles.orderSubsectionHeader}>
                          <View style={[defiStyles.orderSubsectionDot, defiStyles.orderSubsectionDotSell]} />
                          <Text style={[defiStyles.orderSubsectionTitle, defiStyles.orderSubsectionTitleSell]}>
                            Sell Orders
                          </Text>
                          <Text style={[defiStyles.orderSubsectionCount, defiStyles.orderSubsectionCountSell]}>
                            ({sells.length})
                          </Text>
                        </View>
                        {sells.map((order, oi) =>
                          renderOrderCard(order, 'sell', asset.name || 'Asset', `s-${key}-${oi}`)
                        )}
                      </View>
                    ) : null}

                    {totalOrders === 0 ? (
                      <Text style={defiStyles.emptyText}>No open orders for this asset</Text>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
          {openOrders && openOrders.length === 0 && (
            <Text style={defiStyles.emptyText}>No open limit orders</Text>
          )}
          {loadingOrders && !openOrders && (
            <Text style={defiStyles.hintText}>Loading open orders…</Text>
          )}
        </View>
        ) : null}
      </View> : null}

      {showLiquidityBlock ? <View style={[defiStyles.section, defiStyles.sectionLiquidity]}>
        <TouchableOpacity
          style={defiStyles.sectionHeaderPressable}
          onPress={async () => {
            if (showLiquidity) {
              setShowLiquidity(false);
              return;
            }
            if (liquidityPositions == null) await onRefreshLiquidity();
            setShowLiquidity(true);
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ expanded: showLiquidity }}
        >
          <View style={defiStyles.sectionHeaderLeft}>
            <Text style={defiStyles.sectionChevron}>{showLiquidity ? '▼' : '▶'}</Text>
            <Text style={[defiStyles.sectionTitle, { color: liquidityPoolStyles.text }]}>
              My Liquidity Positions
            </Text>
            {liquidityPositions && liquidityPositions.length > 0 ? (
              <Text style={[defiStyles.badge, defiStyles.badgeAmber]}>
                {liquidityPositions.length} pool{liquidityPositions.length !== 1 ? 's' : ''}
              </Text>
            ) : loadingLiquidity && liquidityPositions == null ? (
              <Text style={[defiStyles.badge, defiStyles.badgeAmber]}>…</Text>
            ) : null}
          </View>
        </TouchableOpacity>
        {showLiquidity ? (
        <View style={defiStyles.sectionBody}>
          <View style={[defiStyles.row, { flexWrap: 'wrap', justifyContent: 'flex-start', gap: theme.spacing.sm }]}>
            <TouchableOpacity
              style={defiStyles.compactBtn}
              onPress={() => onRefreshLiquidity()}
              disabled={loadingLiquidity}
            >
              <Text style={defiStyles.compactBtnText}>
                {loadingLiquidity ? 'Loading Liquidity…' : '⟳ Refresh Liquidity'}
              </Text>
            </TouchableOpacity>
          </View>

          {liquidityPositions && liquidityPositions.map((pos) => (
            <View key={pos.hash} style={[defiStyles.cardInset, { marginTop: theme.spacing.md }]}>
              <View style={defiStyles.row}>
                <View style={[defiStyles.row, { flex: 1, justifyContent: 'flex-start' }]}>
                  <View style={[defiStyles.assetAvatar, defiStyles.assetAvatarAmber]}>
                    <Text style={defiStyles.assetAvatarText}>{pos.name?.[0] || 'L'}</Text>
                  </View>
                  <View style={{ marginLeft: theme.spacing.sm, flex: 1 }}>
                    <Text style={defiStyles.cardTitle}>{pos.name} <Text style={defiStyles.cardSub}>LP</Text></Text>
                    <Text style={defiStyles.cardSub}>
                      {pos.assetId != null ? `ID ${pos.assetId} · ` : ''}{pos.decimals} decimals
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={defiStyles.compactBtn} onPress={() => copyHash(pos.hash, 'Asset hash')}>
                  <Text style={[defiStyles.compactBtnText, { fontFamily: theme.typography.fontFamily.mono }]}>
                    {pos.hash.slice(0, 8)}…{pos.hash.slice(-6)}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={defiStyles.statGrid}>
                <View style={defiStyles.statBox}>
                  <Text style={defiStyles.statLabel}>Your LP Shares</Text>
                  <FormattedNumber value={pos.lpBalance} variant="balance" style={defiStyles.statValue} />
                </View>
                <View style={defiStyles.statBox}>
                  <Text style={defiStyles.statLabel}>Pool WART</Text>
                  <FormattedNumber value={pos.poolWart} variant="balance" style={defiStyles.statValue} />
                </View>
                <View style={defiStyles.statBox}>
                  <Text style={defiStyles.statLabel}>Pool {pos.name}</Text>
                  <FormattedNumber value={pos.poolAsset} variant="balance" style={defiStyles.statValue} />
                </View>
              </View>

              <View style={[defiStyles.sectionFooter, { alignItems: 'flex-end' }]}>
                <TouchableOpacity style={defiStyles.compactBtn} onPress={() => onOpenDex({ hash: pos.hash, name: pos.name, mode: 'pool' })}>
                  <Text style={defiStyles.compactBtnText}>Manage in DEX</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {liquidityPositions && liquidityPositions.length === 0 && (
            <View style={[defiStyles.card, { marginTop: theme.spacing.md }]}>
              <Text style={[defiStyles.emptyText, { color: theme.colors.textSecondary }]}>
                No liquidity positions found
              </Text>
              <Text style={defiStyles.hintText}>
                LP shares appear here for tracked assets after you deposit into a pool on the DEX.
              </Text>
            </View>
          )}
          {loadingLiquidity && liquidityPositions == null && (
            <Text style={defiStyles.hintText}>Loading liquidity positions…</Text>
          )}
        </View>
        ) : null}
      </View> : null}
    </View>
  );
};

export default DefiOverviewSection;