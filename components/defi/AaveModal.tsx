import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ethers } from 'ethers';
import DefiModalShell from './DefiModalShell';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import TokenIcon from '../TokenIcon';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import {
  AAVE_MAIN_SPOKE,
  MIN_SAFE_HEALTH_FACTOR,
  WETH_RESERVE_ID,
  formatHealth,
  healthAfterBorrow,
  healthAfterRepay,
  healthAfterWithdraw,
  healthToNumber,
  loadAaveMarket,
  maxSafeBorrow,
  maxSafeWithdraw,
  maxWrappableEth,
  parseAaveAmount,
  planBorrow,
  planRepay,
  planSupply,
  planWithdraw,
  rateToPercent,
  runAaveSteps,
  usdOf,
  type AaveMarket,
  type AaveReserveState,
  type AaveStep,
} from '../../utils/aaveV4';
import { explainEthError } from '../../utils/ethChain';
import { formatRawAmount } from '../../utils/ethHoldings';
import { isLedgerSession } from '../../utils/sessionVault';

interface Props {
  visible: boolean;
  /** Ethereum account of this wallet. */
  address?: string;
  onClose: () => void;
  /** Reload balances elsewhere after a transaction went through. */
  onChanged?: () => void;
}

type Action = 'supply' | 'borrow' | 'repay' | 'withdraw';

/** Supply source that wraps plain ETH into WETH. Other keys are reserve ids. */
const ETH_KEY = 'eth';

type Pending = {
  title: string;
  steps: AaveStep[];
  rows: { label: string; value: string }[];
  doneMessage: string;
};

const green = defiColors.emerald;
const amber = defiColors.amberText;
const red = '#f87171';

function short(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function usd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function amountText(raw: bigint, decimals: number, places = 6): string {
  return formatRawAmount(raw, decimals, places);
}

function healthTone(wad: bigint | null): string {
  const n = healthToNumber(wad);
  if (n == null || !Number.isFinite(n)) return '#f4f4f5';
  if (n < 1.2) return red;
  if (n < MIN_SAFE_HEALTH_FACTOR) return amber;
  return green;
}

function healthLabel(wad: bigint | null): string {
  const n = healthToNumber(wad);
  if (n == null || !Number.isFinite(n)) return 'No debt';
  if (n < 1.2) return 'At risk';
  if (n < MIN_SAFE_HEALTH_FACTOR) return 'Caution';
  return 'Healthy';
}

function explainAave(error: unknown): string {
  const base = explainEthError(error);
  if (/unknown custom error/i.test(base)) {
    return "Aave rejected this transaction (a protocol limit or the health factor was hit). Nothing was sent. Try a smaller amount.";
  }
  if (/bridged amount/i.test(base)) {
    return 'Leave some ETH for the Ethereum network fee. The amount you send is on top of gas.';
  }
  return base;
}

function roomText(row: AaveReserveState): string {
  return row.borrowRoom === ethers.MaxUint256 ? 'no cap' : `${amountText(row.borrowRoom, row.decimals, 2)} ${row.symbol}`;
}

const ACTIONS: { id: Action; label: string }[] = [
  { id: 'supply', label: 'Supply' },
  { id: 'borrow', label: 'Borrow' },
  { id: 'repay', label: 'Repay' },
  { id: 'withdraw', label: 'Withdraw' },
];

const local = {
  sectionTitle: {
    color: '#71717a',
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
  },
  assetRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 6,
  },
  assetSymbol: { color: '#f4f4f5', fontSize: 14, fontWeight: '600' as const },
  assetSub: { color: '#71717a', fontSize: 10 },
  assetValue: { color: '#e4e4e7', fontSize: 12, textAlign: 'right' as const, fontVariant: ['tabular-nums' as const] },
  statGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  stat: {
    flexBasis: '48%' as const,
    flexGrow: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(9, 9, 11, 0.45)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statLabel: { color: '#71717a', fontSize: 10, textTransform: 'uppercase' as const },
  statValue: { color: '#f4f4f5', fontSize: 14, fontVariant: ['tabular-nums' as const] },
  choice: {
    flexBasis: '48%' as const,
    flexGrow: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(63, 63, 70, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  choiceOn: { borderColor: 'rgba(253, 185, 19, 0.75)', backgroundColor: 'rgba(253, 185, 19, 0.1)' },
  check: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#71717a',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  checkText: { flex: 1, color: '#d4d4d8', fontSize: 11, lineHeight: 16 },
  warnBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.4)',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    padding: 10,
    gap: 6,
  },
  warnText: { color: '#fde68a', fontSize: 11, lineHeight: 16 },
};

function Check({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <TouchableOpacity style={local.check} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[local.checkBox, on && { borderColor: defiColors.gold, backgroundColor: 'rgba(253, 185, 19, 0.2)' }]}>
        {on ? <Text style={{ color: defiColors.gold, fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={local.checkText}>{children}</Text>
    </TouchableOpacity>
  );
}

function AssetRow({
  symbol,
  sub,
  value,
  sub2,
  onPress,
}: {
  symbol: string;
  sub?: string;
  value: string;
  sub2?: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={local.assetRow}>
      <TokenIcon symbol={symbol} size={26} />
      <View style={{ flex: 1 }}>
        <Text style={local.assetSymbol}>{symbol}</Text>
        {sub ? <Text style={local.assetSub}>{sub}</Text> : null}
      </View>
      <View>
        <Text style={local.assetValue}>{value}</Text>
        {sub2 ? <Text style={[local.assetSub, { textAlign: 'right' }]}>{sub2}</Text> : null}
      </View>
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress}>{body}</TouchableOpacity> : body;
}

/**
 * Aave v4 on Ethereum mainnet: supply collateral, borrow, repay, withdraw on the Main Spoke.
 * Signing goes through the wallet's existing Ethereum path (`sendEthCall`).
 */
const AaveModal: React.FC<Props> = ({ visible, address, onClose, onChanged }) => {
  const flow = useSpendFlow();
  const owner = address || '';

  const [market, setMarket] = useState<AaveMarket | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action>('supply');
  const [assetKey, setAssetKey] = useState<string>(ETH_KEY);
  const [amount, setAmount] = useState('');
  const [maxMode, setMaxMode] = useState(false);
  const [unwrap, setUnwrap] = useState(true);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [planning, setPlanning] = useState(false);

  const refresh = useCallback(async () => {
    if (!owner) return;
    setLoading(true);
    setLoadError('');
    try {
      setMarket(await loadAaveMarket(owner));
    } catch (err) {
      setLoadError(explainAave(err));
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    if (!visible) return;
    setMarket(null);
    void refresh();
  }, [visible, refresh]);

  const weth = market?.reserves.find((row) => row.id === WETH_RESERVE_ID);
  const supplyList = useMemo(
    () => (market?.reserves ?? []).filter((row) => row.collateral && row.collateralFactorBps > 0 && !row.frozen && !row.paused),
    [market],
  );
  const collateralList = useMemo(
    () => (market?.reserves ?? []).filter((row) => row.collateral && (row.collateralFactorBps > 0 || row.supplied > 0n)),
    [market],
  );
  const borrowList = useMemo(() => (market?.reserves ?? []).filter((row) => row.canBorrow), [market]);
  const debtList = useMemo(() => (market?.reserves ?? []).filter((row) => row.debt > 0n), [market]);

  const choices = useMemo((): { key: string; symbol: string; sub: string }[] => {
    if (action === 'supply') {
      return [
        ...(weth ? [{ key: ETH_KEY, symbol: 'ETH', sub: 'wraps to WETH' }] : []),
        ...supplyList.map((row) => ({ key: String(row.id), symbol: row.symbol, sub: `LTV ${(row.collateralFactorBps / 100).toFixed(0)}%` })),
      ];
    }
    if (action === 'withdraw') {
      return collateralList.map((row) => ({ key: String(row.id), symbol: row.symbol, sub: `${amountText(row.supplied, row.decimals, 4)} supplied` }));
    }
    if (action === 'borrow') {
      return borrowList.map((row) => ({ key: String(row.id), symbol: row.symbol, sub: `~${rateToPercent(row.drawnRateRay)} APR${row.id === WETH_RESERVE_ID ? ' · or ETH' : ''}` }));
    }
    return debtList.map((row) => ({ key: String(row.id), symbol: row.symbol, sub: `owe ${amountText(row.debt, row.decimals, 4)}` }));
  }, [action, weth, supplyList, collateralList, borrowList, debtList]);

  const activeKey = choices.some((c) => c.key === assetKey) ? assetKey : choices[0]?.key ?? '';
  const fromEth = action === 'supply' && activeKey === ETH_KEY;
  const selected: AaveReserveState | undefined = market?.reserves.find(
    (row) => String(row.id) === (fromEth ? String(WETH_RESERVE_ID) : activeKey),
  );
  const isWeth = selected?.id === WETH_RESERVE_ID;
  const symbolShown = fromEth ? 'ETH' : selected?.symbol ?? '';

  const priceDecimals = market?.priceDecimals ?? 8;
  const account = market?.account;
  const collateralUsd = account ? Number(account.totalCollateralValue / 10n ** 18n) / 10 ** priceDecimals : 0;
  const debtUsd = account ? Number(account.totalDebtValueRay / 10n ** 45n) / 10 ** priceDecimals : 0;
  const hfNow = account?.healthFactorWad ?? null;

  const parsed = useMemo((): bigint | null => {
    if (!selected || !amount.trim()) return null;
    try {
      return parseAaveAmount(amount, selected.decimals);
    } catch {
      return null;
    }
  }, [selected, amount]);

  const projected = useMemo((): { text: string; wad: bigint | null } | null => {
    if (!market || !selected || parsed == null) return null;
    if (action === 'borrow') {
      const wad = healthAfterBorrow(market, selected, parsed);
      return { text: formatHealth(wad), wad };
    }
    if (action === 'repay') {
      const wad = healthAfterRepay(market, selected, parsed > selected.debt ? selected.debt : parsed);
      return { text: formatHealth(wad), wad };
    }
    if (action === 'withdraw') {
      const wad = healthAfterWithdraw(market, selected, parsed);
      return { text: formatHealth(wad), wad };
    }
    return null;
  }, [market, selected, parsed, action]);

  const room = (): string => {
    if (!selected || !market) return '';
    if (action === 'supply') {
      if (fromEth) {
        return `ETH in wallet ${amountText(market.ethBalance, 18)} · keeps ${amountText(market.ethGasReserve, 18, 4)} ETH for gas · most you can supply ${amountText(maxWrappableEth(market), 18)}`;
      }
      return `In wallet ${amountText(selected.walletBalance, selected.decimals)} ${selected.symbol} · supply room ${selected.supplyRoom === ethers.MaxUint256 ? 'no cap' : amountText(selected.supplyRoom, selected.decimals, 2)}`;
    }
    if (action === 'withdraw') {
      return `Supplied ${amountText(selected.supplied, selected.decimals)} ${selected.symbol} · safe to withdraw ${amountText(maxSafeWithdraw(market, selected), selected.decimals)}`;
    }
    if (action === 'borrow') {
      return `Safe to borrow now ${amountText(maxSafeBorrow(market, selected), selected.decimals)} ${selected.symbol} (keeps health factor ≥ ${MIN_SAFE_HEALTH_FACTOR.toFixed(1)}) · room under Aave's limits ${roomText(selected)}`;
    }
    const base = `Debt ${amountText(selected.debt, selected.decimals, 8)} ${selected.symbol} · in wallet ${amountText(selected.walletBalance, selected.decimals)}`;
    return isWeth ? `${base} · ETH ${amountText(market.ethBalance, 18)} can be wrapped to cover a shortfall` : base;
  };

  const onMax = (): void => {
    if (!selected || !market) return;
    let raw = 0n;
    let full = false;
    if (action === 'supply') raw = fromEth ? maxWrappableEth(market) : selected.walletBalance;
    else if (action === 'withdraw') {
      raw = maxSafeWithdraw(market, selected);
      full = raw >= selected.supplied;
    } else if (action === 'borrow') raw = maxSafeBorrow(market, selected);
    else {
      raw = selected.debt;
      full = true;
    }
    setAmount(raw > 0n ? ethers.formatUnits(raw, selected.decimals) : '');
    setMaxMode(full);
  };

  const review = async () => {
    setError('');
    setNotice('');
    if (!market || !selected || !owner) return;
    if (!ack) {
      setError('Tick the box to confirm you understand the liquidation risk.');
      return;
    }
    let raw: bigint;
    try {
      raw = parseAaveAmount(amount, selected.decimals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enter an amount.');
      return;
    }
    setPlanning(true);
    try {
      const sym = selected.symbol;
      const typed = amount.trim();
      let steps: AaveStep[];
      let rows: { label: string; value: string }[];
      let title: string;
      let doneMessage: string;
      if (action === 'supply') {
        steps = await planSupply(owner, market, selected, raw, fromEth);
        title = 'Confirm supply';
        rows = [
          { label: 'Supply', value: fromEth ? `${typed} ETH (wrapped to WETH, then supplied as WETH)` : `${typed} ${sym}` },
          { label: 'Collateral', value: `${sym} will be enabled as collateral` },
          { label: 'Collateral factor', value: `${(selected.collateralFactorBps / 100).toFixed(0)}%` },
        ];
        doneMessage = `${typed} ${fromEth ? 'ETH' : sym} supplied to Aave v4${fromEth ? ' as WETH' : ''}.`;
      } else if (action === 'borrow') {
        const toEth = unwrap && isWeth;
        steps = planBorrow(owner, market, selected, raw, toEth);
        title = 'Confirm borrow';
        rows = [
          { label: 'Borrow', value: `${typed} ${sym}${toEth ? ' (unwrapped to ETH)' : ''}` },
          { label: 'Health factor after', value: formatHealth(healthAfterBorrow(market, selected, raw)) },
          { label: 'Variable rate', value: `~${rateToPercent(selected.drawnRateRay)} APR + ${(market.account.riskPremiumBps / 100).toFixed(2)}% risk premium` },
        ];
        doneMessage = `${typed} ${sym} borrowed${toEth ? ' and unwrapped to ETH' : ''}.`;
      } else if (action === 'repay') {
        const full = maxMode || raw >= selected.debt;
        steps = await planRepay(owner, market, selected, raw > selected.debt ? selected.debt : raw, full);
        title = 'Confirm repayment';
        rows = [
          { label: 'Repay', value: full ? `All ${sym} debt (~${amountText(selected.debt, selected.decimals, 8)} ${sym})` : `${typed} ${sym}` },
          { label: 'Health factor after', value: formatHealth(healthAfterRepay(market, selected, full ? selected.debt : raw)) },
          { label: 'Paid from', value: isWeth ? 'WETH in this wallet. ETH is wrapped first if needed.' : `${sym} in this wallet` },
        ];
        doneMessage = full ? `${sym} debt repaid.` : `${typed} ${sym} repaid.`;
      } else {
        const full = maxMode || raw >= selected.supplied;
        const toEth = unwrap && isWeth;
        steps = planWithdraw(owner, market, selected, raw, full, toEth);
        title = 'Confirm withdrawal';
        rows = [
          { label: 'Withdraw', value: `${full ? `All ${sym} (${amountText(selected.supplied, selected.decimals)})` : `${typed} ${sym}`}${toEth ? ' (unwrapped to ETH)' : ''}` },
          { label: 'Health factor after', value: formatHealth(healthAfterWithdraw(market, selected, full ? selected.supplied : raw)) },
        ];
        doneMessage = `${typed} ${sym} withdrawn from Aave v4${toEth ? ' and unwrapped to ETH' : ''}.`;
      }
      rows.push(
        { label: 'Transactions', value: `${steps.length}: ${steps.map((step) => step.label).join(' → ')}` },
        { label: 'Contract', value: `Aave v4 Main Spoke ${short(AAVE_MAIN_SPOKE)}` },
        { label: 'Network fee', value: 'Paid in ETH for every transaction above. Estimated when each one is sent.' },
      );
      setPending({ title, steps, rows, doneMessage });
    } catch (err) {
      setError(explainAave(err));
    } finally {
      setPlanning(false);
    }
  };

  const submit = async () => {
    if (!pending) return;
    flow.begin('Waiting for the wallet to sign…');
    let sent = 0;
    try {
      await runAaveSteps(pending.steps, (label, index, total) => {
        sent = index - 1;
        flow.setStep(`Step ${index} of ${total}: ${label}`);
      });
      sent = pending.steps.length;
      setNotice(pending.doneMessage);
      flow.finish(true, 'Done', pending.doneMessage);
      setAmount('');
      setMaxMode(false);
      void refresh();
      onChanged?.();
    } catch (err) {
      const done = sent > 0 ? ` ${sent} earlier step${sent === 1 ? '' : 's'} already went through. Check your position before retrying.` : '';
      flow.finish(false, 'Could not finish', `${explainAave(err)}${done}`);
      void refresh();
      onChanged?.();
    }
  };

  const pickAction = (id: Action): void => {
    setAction(id);
    setAssetKey('');
    setAmount('');
    setMaxMode(false);
    setError('');
  };

  const verb = action === 'supply' ? 'supply' : action === 'borrow' ? 'borrow' : action === 'repay' ? 'repayment' : 'withdrawal';
  const ctaLabel = planning
    ? 'Checking…'
    : flow.busy
      ? 'Working…'
      : !market
        ? loadError ? 'Aave unavailable' : 'Loading Aave…'
        : !selected
          ? action === 'repay' ? 'No debt to repay' : 'Nothing to choose'
          : !amount.trim()
            ? 'Enter an amount'
            : `Review ${verb}`;
  const ctaDisabled = !market || !selected || planning || flow.busy || !amount.trim();
  const belowSafe = (action === 'borrow' || action === 'withdraw')
    && projected != null
    && projected.wad != null
    && (healthToNumber(projected.wad) ?? Infinity) < MIN_SAFE_HEALTH_FACTOR;

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Aave v4"
      subtitle={`Ethereum mainnet · Main Spoke ${short(AAVE_MAIN_SPOKE)}`}
    >
      {!owner ? (
        <Text style={styles.hint}>
          This wallet has no Ethereum account yet. A recovery phrase includes one. On a Ledger, add it from the home screen with the Ethereum app open.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={styles.hint}>
            Aave holds WETH, a 1:1 wrapped version of ETH, so this wallet wraps your ETH for you when you supply it, and
            unwraps back to ETH when you borrow or withdraw WETH if you leave that option on.
          </Text>

          <View style={local.warnBox}>
            <Text style={[local.warnText, { fontWeight: '700' }]}>Read before you borrow</Text>
            <Text style={local.warnText}>
              If the health factor falls below 1.00 your collateral can be liquidated, with a penalty. Prices move, interest
              accrues every block, and your rate can change. Borrowing a volatile asset (WETH, WBTC, cbBTC) against other
              collateral adds price risk both ways. This wallet blocks a borrow or withdrawal that would leave the health
              factor under {MIN_SAFE_HEALTH_FACTOR.toFixed(1)}, but staying safe afterwards is up to you.
            </Text>
            <Text style={local.warnText}>
              Amounts offered are conservative: the largest borrow keeps the health factor at {MIN_SAFE_HEALTH_FACTOR.toFixed(1)} and
              uses at most 90% of the remaining borrow cap or pool liquidity. Every step is a separate Ethereum transaction and
              pays gas. This integration has not been tested with real funds, so start with a small amount.
            </Text>
          </View>

          {isLedgerSession() ? (
            <Text style={styles.hint}>
              The Ethereum app approves each step. Turn on Blind signing in that app first.
            </Text>
          ) : null}

          <View style={styles.panel}>
            <View style={[styles.rowBetween, { marginBottom: 8 }]}>
              <Text style={local.sectionTitle}>Your position</Text>
              <TouchableOpacity onPress={() => { void refresh(); }} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color={defiColors.gold} /> : (
                  <Text style={{ color: defiColors.gold, fontSize: 11 }}>Refresh</Text>
                )}
              </TouchableOpacity>
            </View>
            {loadError ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.warn}>{loadError}</Text>
                <TouchableOpacity onPress={() => { void refresh(); }}>
                  <Text style={{ color: defiColors.gold, fontSize: 12, fontWeight: '600' }}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {market && account ? (
              <View style={{ gap: 8 }}>
                <View style={[styles.rowBetween, { alignItems: 'center' }]}>
                  <View>
                    <Text style={local.statLabel}>Health factor</Text>
                    <Text style={{ color: healthTone(hfNow), fontSize: 24, fontWeight: '700' }}>{formatHealth(hfNow)}</Text>
                  </View>
                  <Text style={{ color: healthTone(hfNow), fontSize: 12, fontWeight: '600' }}>{healthLabel(hfNow)}</Text>
                </View>
                <View style={local.statGrid}>
                  <View style={local.stat}><Text style={local.statLabel}>Collateral</Text><Text style={local.statValue}>{usd(collateralUsd)}</Text></View>
                  <View style={local.stat}><Text style={local.statLabel}>Debt</Text><Text style={local.statValue}>{usd(debtUsd)}</Text></View>
                  <View style={local.stat}><Text style={local.statLabel}>ETH in wallet</Text><Text style={local.statValue}>{amountText(market.ethBalance, 18)}</Text></View>
                  <View style={local.stat}><Text style={local.statLabel}>WETH in wallet</Text><Text style={local.statValue}>{weth ? amountText(weth.walletBalance, 18) : '—'}</Text></View>
                </View>
                {account.riskPremiumBps > 0 ? (
                  <Text style={styles.balanceHint}>Risk premium on borrows: +{(account.riskPremiumBps / 100).toFixed(2)}%</Text>
                ) : null}
                {debtList.length > 0 ? (
                  <View>
                    <Text style={local.statLabel}>Borrowed</Text>
                    {debtList.map((row) => (
                      <AssetRow
                        key={row.id}
                        symbol={row.symbol}
                        sub={`~${rateToPercent(row.drawnRateRay)} APR`}
                        value={amountText(row.debt, row.decimals, 6)}
                      />
                    ))}
                  </View>
                ) : null}
                {market.skipped.length > 0 ? (
                  <Text style={styles.warn}>Aave no longer lists {market.skipped.join(', ')} at the expected id, so it is hidden.</Text>
                ) : null}
              </View>
            ) : !loadError ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={defiColors.gold} />
                <Text style={styles.mutedLabel}>Reading Aave…</Text>
              </View>
            ) : null}
          </View>

          {market ? (
            <View style={styles.panel}>
              <View style={styles.rowBetween}>
                <Text style={local.sectionTitle}>Collateral</Text>
                <Text style={styles.balanceHint}>wallet · supplied</Text>
              </View>
              {collateralList.map((row) => (
                <AssetRow
                  key={row.id}
                  symbol={row.symbol}
                  sub={`LTV ${(row.collateralFactorBps / 100).toFixed(0)}%${row.supplied > 0n ? (row.enabledAsCollateral ? ' · collateral on' : ' · collateral off') : ''}`}
                  value={`${amountText(row.walletBalance, row.decimals, 4)} · ${amountText(row.supplied, row.decimals, 4)}`}
                  sub2={`≈ ${usd(usdOf(row.supplied, row.price, row.decimals, priceDecimals))}`}
                  onPress={() => {
                    setAction(action === 'withdraw' ? 'withdraw' : 'supply');
                    setAssetKey(String(row.id));
                    setAmount('');
                    setMaxMode(false);
                  }}
                />
              ))}
            </View>
          ) : null}

          {market ? (
            <View style={styles.panel}>
              <View style={styles.rowBetween}>
                <Text style={local.sectionTitle}>Borrow markets</Text>
                <Text style={styles.balanceHint}>rate · room</Text>
              </View>
              {borrowList.map((row) => (
                <AssetRow
                  key={row.id}
                  symbol={row.symbol}
                  value={`~${rateToPercent(row.drawnRateRay)} APR`}
                  sub2={`room ${roomText(row)}`}
                  onPress={() => {
                    setAction('borrow');
                    setAssetKey(String(row.id));
                    setAmount('');
                    setMaxMode(false);
                  }}
                />
              ))}
            </View>
          ) : null}

          <View style={[styles.panel, { gap: 10 }]}>
            <Text style={local.sectionTitle}>Action</Text>
            <View style={styles.chipRow}>
              {ACTIONS.map((choice) => (
                <TouchableOpacity
                  key={choice.id}
                  style={[styles.chip, action === choice.id && styles.chipActive]}
                  onPress={() => pickAction(choice.id)}
                >
                  <Text style={[styles.chipText, action === choice.id && styles.chipTextActive]}>{choice.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {choices.length > 0 ? (
              <View style={local.statGrid}>
                {choices.map((choice) => (
                  <TouchableOpacity
                    key={choice.key}
                    style={[local.choice, choice.key === activeKey && local.choiceOn]}
                    onPress={() => { setAssetKey(choice.key); setAmount(''); setMaxMode(false); }}
                  >
                    <TokenIcon symbol={choice.symbol} size={22} />
                    <View style={{ flex: 1 }}>
                      <Text style={local.assetSymbol}>{choice.symbol}</Text>
                      <Text style={local.assetSub} numberOfLines={1}>{choice.sub}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>
                {!market ? 'Loading assets…' : action === 'repay' ? 'You have no debt on this Spoke.' : 'Nothing available yet.'}
              </Text>
            )}
            <View style={styles.amountRow}>
              {symbolShown ? <TokenIcon symbol={symbolShown} size={24} /> : null}
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(text) => { setAmount(text.replace(/[^0-9.]/g, '')); setMaxMode(false); setError(''); }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#3f3f46"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.chip} onPress={onMax} disabled={!selected || !market}>
                <Text style={styles.chipText}>MAX</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.balanceHint}>{room()}</Text>
            {(action === 'borrow' || action === 'withdraw') && isWeth ? (
              <Check on={unwrap} onPress={() => setUnwrap((v) => !v)}>
                Unwrap to ETH after {action === 'borrow' ? 'borrowing' : 'withdrawing'} (one extra transaction)
              </Check>
            ) : null}
            {projected && action !== 'supply' ? (
              <Text style={[styles.summaryValue, { fontSize: 12 }]}>
                Health factor after:{' '}
                <Text style={{ color: healthTone(projected.wad), fontWeight: '700' }}>{projected.text}</Text>
                {belowSafe ? <Text style={{ color: red }}> — below {MIN_SAFE_HEALTH_FACTOR.toFixed(1)}, blocked</Text> : null}
              </Text>
            ) : null}
            <Check on={ack} onPress={() => setAck((v) => !v)}>
              I understand my collateral can be liquidated and that this has not been tested with real funds.
            </Check>
            {error ? <Text style={styles.warn}>{error}</Text> : null}
            {notice ? <Text style={{ color: green, fontSize: 12 }}>{notice}</Text> : null}
            <TouchableOpacity
              style={[styles.cta, ctaDisabled && styles.ctaDisabled]}
              disabled={ctaDisabled}
              onPress={() => { void review(); }}
            >
              <Text style={styles.ctaText}>{ctaLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <SpendConfirm
        open={pending != null}
        title={pending?.title ?? ''}
        rows={pending?.rows ?? []}
        confirmLabel="Confirm and sign"
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        onCancel={() => {
          flow.close();
          setPending(null);
        }}
        onConfirm={() => { void submit(); }}
      />
    </DefiModalShell>
  );
};

export default AaveModal;
