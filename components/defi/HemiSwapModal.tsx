import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DefiModalShell from './DefiModalShell';
import HemiTunnelModal from './HemiTunnelModal';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { SpinCoin, formatWhen, styles as tunnelStyles } from './tunnelUi';
import FormattedNumber from '../FormattedNumber';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { formatRawAmount, formatRawAmountFloor, rawToDecimal } from '../../utils/ethHoldings';
import { explainEthError, parseTokenAmount, readRawHoldings } from '../../utils/ethChain';
import { explainChainError } from '../../utils/networks/http';
import {
  executeHemiSushi,
  quoteHemiSushiPair,
  readHemiSwapBalances,
  type HemiSushiLeg,
  type HemiSushiQuote,
} from '../../utils/networks/hemiSushi';
import { readOneBalance } from '../../utils/tokenBalances';
import AssetMenu from './AssetMenu';
import { useWalletTokens } from './useWalletTokens';
import type { WalletToken } from '../../utils/walletTokens';
import {
  executeStargate,
  quoteStargate,
  saveStargateMove,
  stargateStep,
  syncStargateMoves,
  type StargateDirection,
  type StargateMove,
  type StargateQuote,
  type StargateView,
} from '../../utils/networks/stargate';
import { isLedgerSession } from '../../utils/sessionVault';
import { toast } from '../../utils/toast';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';

interface Props {
  visible: boolean;
  address: string;
  btcAddress?: string;
  ledger?: boolean;
  onClose: () => void;
  /** Reload Ethereum after a mainnet Stargate send, and Hemi after a Hemi send. */
  onBalances: () => void;
  embedded?: boolean;
}

const SLIPPAGE = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
] as const;

const GAS_RESERVE = 2_000_000_000_000_000n;
const HEMI_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

function sushiLeg(token: WalletToken): HemiSushiLeg {
  return {
    symbol: token.symbol,
    address: token.native ? HEMI_NATIVE : token.address,
    decimals: token.decimals,
    native: token.native,
  };
}

function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/sushi|stargate|hemi rpc/i.test(message)) return explainChainError(err);
  return explainEthError(err);
}

const HemiSwapModal: React.FC<Props> = ({
  visible,
  address,
  btcAddress,
  ledger,
  onClose,
  onBalances,
  embedded = false,
}) => {
  const [panel, setPanel] = useState<'swap' | 'tunnel'>('swap');
  const [venue, setVenue] = useState<'stargate' | 'sushi'>('stargate');
  const [stargateDir, setStargateDir] = useState<StargateDirection>('to-hemi');
  const { tokens } = useWalletTokens('hemi');
  const [sushiPayToken, setSushiPayToken] = useState<WalletToken>(tokens[0]);
  const [sushiReceiveToken, setSushiReceiveToken] = useState<WalletToken>(
    tokens.find((token) => token.symbol === 'USDT') ?? tokens[1],
  );

  const [sushiRaw, setSushiRaw] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [hemi, setHemi] = useState<{ eth: bigint; usdt: bigint } | null>(null);
  const [l1Eth, setL1Eth] = useState<bigint | null>(null);
  const [stargateQuote, setStargateQuote] = useState<StargateQuote | null>(null);
  const [sushiQuote, setSushiQuote] = useState<HemiSushiQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stargateMoves, setStargateMoves] = useState<{ move: StargateMove; view: StargateView }[]>([]);
  const flow = useSpendFlow();
  const sending = useRef(false);
  const trackingHash = useRef<string | null>(null);
  const confirmRef = useRef(false);
  const told = useRef(new Set<string>());
  const balancesRef = useRef(onBalances);
  const noteRef = useRef(flow.note);
  const finishRef = useRef(flow.finish);
  const reloadStargate = useRef<() => Promise<void>>(async () => undefined);
  confirmRef.current = confirmOpen;
  balancesRef.current = onBalances;
  noteRef.current = flow.note;
  finishRef.current = flow.finish;
  const { formatBalance } = useNumberDisplay();

  const tunnel = panel === 'tunnel';
  const stargate = !tunnel && venue === 'stargate';
  const sushiPay = sushiPayToken.symbol;
  const sushiReceive = sushiReceiveToken.symbol;
  const payDecimals = stargate ? 18 : sushiPayToken.decimals;

  const reload = async () => {
    const [onHemi, onEth] = await Promise.all([
      readHemiSwapBalances(address),
      readRawHoldings(address),
    ]);
    setHemi(onHemi);
    setL1Eth(onEth.eth);
  };

  useEffect(() => {
    if (!visible) return undefined;
    let cancel = false;
    const run = async () => {
      try {
        const synced = await syncStargateMoves(address);
        if (cancel) return;
        setStargateMoves(synced.open);
        for (const item of synced.changed) {
          const key = `${item.move.id}:${item.move.status}`;
          if (told.current.has(key)) continue;
          told.current.add(key);
          const watching = trackingHash.current === item.move.txHash;
          if (watching) trackingHash.current = null;
          if (item.view.done) {
            if (watching && confirmRef.current) finishRef.current(true, 'ETH arrived', item.view.message);
            else toast.success('ETH arrived', item.view.message);
            balancesRef.current();
          } else if (item.view.failed) {
            if (watching && confirmRef.current) finishRef.current(false, item.view.step, item.view.message);
            else toast.error(item.view.step, item.view.message);
          }
        }
        const watch = trackingHash.current;
        const current = synced.open.find((item) => item.move.txHash === watch);
        if (watch && current && confirmRef.current) noteRef.current(current.view.step, current.view.message);
      } catch {
        /* keep the last cards */
      }
    };
    reloadStargate.current = run;
    void run();
    const timer = setInterval(() => { void run(); }, 15_000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [visible, address]);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    confirmRef.current = false;
    trackingHash.current = null;
    flow.close();
    setConfirmOpen(false);
    let cancel = false;
    void reload().catch((err: unknown) => { if (!cancel) setError(explain(err)); });
    return () => { cancel = true; };
  }, [visible, address]);

  useEffect(() => {
    if (!visible || sushiPayToken.native) {
      setSushiRaw(null);
      return;
    }
    let cancel = false;
    void readOneBalance('hemi', address, sushiPayToken)
      .then((value) => { if (!cancel) setSushiRaw(value); })
      .catch(() => { if (!cancel) setSushiRaw(null); });
    return () => { cancel = true; };
  }, [visible, address, sushiPayToken]);

  useEffect(() => {
    if (!visible || !stargate) {
      setStargateQuote(null);
      if (!stargate) setQuoting(false);
      return;
    }
    const text = amount.trim();
    if (!text || text === '.' || /^\d+\.$/.test(text)) {
      setStargateQuote(null);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    setStargateQuote(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const raw = parseTokenAmount(text, 18);
          const next = await quoteStargate(stargateDir, address, raw);
          if (!cancel) {
            setStargateQuote(next);
            setError(null);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setStargateQuote(null);
            setError(explain(err));
          }
        } finally {
          if (!cancel) setQuoting(false);
        }
      })();
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [visible, stargate, stargateDir, amount, address]);

  useEffect(() => {
    if (!visible || tunnel || venue !== 'sushi') {
      setSushiQuote(null);
      return;
    }
    const text = amount.trim();
    if (!text || text === '.' || /^\d+\.$/.test(text)) {
      setSushiQuote(null);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    setSushiQuote(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const raw = parseTokenAmount(text, sushiPayToken.decimals);
          const next = await quoteHemiSushiPair(
            sushiLeg(sushiPayToken),
            sushiLeg(sushiReceiveToken),
            raw,
            slippageBps,
            address,
          );
          if (!cancel) {
            setSushiQuote(next);
            setError(null);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setSushiQuote(null);
            setError(explain(err));
          }
        } finally {
          if (!cancel) setQuoting(false);
        }
      })();
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [visible, tunnel, venue, sushiPayToken, sushiReceiveToken, amount, slippageBps, address]);

  const availableRaw = stargate
    ? (stargateDir === 'to-hemi' ? l1Eth : hemi?.eth) ?? null
    : sushiPayToken.native ? (hemi?.eth ?? null) : sushiRaw;
  const availableValue = availableRaw == null ? null : rawToDecimal(availableRaw, payDecimals);
  const spendRaw = stargate && stargateQuote ? stargateQuote.value : null;

  let overBalance = false;
  if (availableRaw != null && amount.trim() && amount.trim() !== '.' && !/^\d+\.$/.test(amount.trim())) {
    try {
      const typed = parseTokenAmount(amount, payDecimals);
      overBalance = (spendRaw ?? typed) > availableRaw;
    } catch {
      overBalance = false;
    }
  }

  const quote = stargate ? stargateQuote : sushiQuote;
  const received = stargateQuote
    ? formatRawAmount(stargateQuote.amountOut, 18, 6)
    : sushiQuote
      ? formatRawAmount(sushiQuote.amountOut, sushiReceiveToken.decimals, 6)
      : '0';
  const minimum = stargateQuote
    ? `${formatRawAmount(stargateQuote.amountOut, 18, 6)} ETH`
    : sushiQuote
      ? `${formatRawAmount(sushiQuote.amountOutMin, sushiReceiveToken.decimals, 6)} ${sushiReceive}`
      : '—';

  const blockReason = overBalance
    ? `Only ${availableValue == null ? '0' : formatBalance(availableValue)} ${stargate ? 'ETH' : sushiPay} is free in this wallet.`
    : null;

  const fillMax = () => {
    if (availableRaw == null) return;
    const reserve = (stargate || sushiPayToken.native) ? GAS_RESERVE : 0n;
    const max = availableRaw > reserve ? availableRaw - reserve : 0n;
    if (max <= 0n) {
      setError(stargate || sushiPayToken.native ? 'Not enough ETH to pay the fee.' : `This wallet has no ${sushiPay} on Hemi.`);
      return;
    }
    setAmount(formatRawAmountFloor(max, payDecimals, 6));
    setError(null);
  };

  const flip = () => {
    setAmount('');
    setError(null);
    setConfirmOpen(false);
    if (stargate) setStargateDir((dir) => (dir === 'to-hemi' ? 'to-ethereum' : 'to-hemi'));
    else {
      setSushiPayToken(sushiReceiveToken);
      setSushiReceiveToken(sushiPayToken);
    }
  };

  const choose = (side: 'pay' | 'receive', token: WalletToken) => {
    if (side === 'pay') {
      if (token.id === sushiReceiveToken.id) setSushiReceiveToken(sushiPayToken);
      setSushiPayToken(token);
    } else {
      if (token.id === sushiPayToken.id) setSushiPayToken(sushiReceiveToken);
      setSushiReceiveToken(token);
    }
    setAmount('');
    setError(null);
    setVenue('sushi');
  };

  const submit = () => {
    if (sending.current || flow.busy) return;
    sending.current = true;
    const currentStargate = stargateQuote;
    const currentSushi = sushiQuote;
    const account = address;
    const paid = amount.trim();
    const from = stargateDir === 'to-hemi' ? 'Ethereum' : 'Hemi';
    flow.begin(stargate
      ? `Step 1 of 3 · Sending on ${from}`
      : `Swapping ${paid} ${sushiPay} for ${sushiReceive}…`);
    void (async () => {
      let settled = false;
      try {
        if (currentStargate) {
          const hash = await executeStargate(currentStargate, account);
          const move: StargateMove = {
            id: hash,
            direction: currentStargate.direction,
            createdAt: Date.now(),
            amountIn: currentStargate.amountIn.toString(),
            amountOut: currentStargate.amountOut.toString(),
            address: account,
            txHash: hash,
            status: 'inflight',
          };
          trackingHash.current = hash;
          const first = stargateStep(move.direction, { indexed: false, name: '', source: '', destination: '' });
          flow.hold(first.step, first.message);
          settled = true;
          try {
            await saveStargateMove(move);
            void reloadStargate.current();
          } catch {
            setError('The ETH was sent. This device could not save the tracker.');
          }
        } else if (currentSushi) {
          flow.setStep('Waiting for Hemi to confirm…');
          const hash = await executeHemiSushi(currentSushi, account);
          flow.finish(true, 'Swapped', `${paid} ${sushiPay} for ${sushiReceive} on Hemi. ${hash.slice(0, 10)}…`);
        } else {
          flow.finish(false, 'Swap failed', 'The quote expired. Enter the amount again.');
        }
        settled = true;
        onBalances();
        try { await reload(); } catch { /* the home card reloads too */ }
      } catch (err: unknown) {
        const message = explain(err);
        setError(message);
        if (!settled) flow.finish(false, 'Swap failed', message);
        onBalances();
      } finally {
        sending.current = false;
      }
    })();
  };

  const subtitle = tunnel
    ? 'Bitcoin and ETH'
    : stargate
      ? (stargateDir === 'to-hemi' ? 'ETH · Ethereum → Hemi' : 'ETH · Hemi → Ethereum')
      : `${sushiPay} → ${sushiReceive} · Hemi`;
  const slippageLabel = SLIPPAGE.find((choice) => choice.bps === slippageBps)?.label ?? `${slippageBps / 100}%`;

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Swap"
      subtitle="Hemi. Stargate moves ETH. Sushi swaps on Hemi."
      embedded={embedded}
      showClose={!embedded}
    >
      <View style={styles.swapCard}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.chipRow}>
              {(['swap', 'tunnel'] as const).map((choice) => {
                const on = choice === 'tunnel' ? tunnel : !tunnel;
                return (
                  <TouchableOpacity
                    key={choice}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => {
                      confirmRef.current = false;
                      trackingHash.current = null;
                      flow.close();
                      setPanel(choice);
                      setConfirmOpen(false);
                    }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>
                      {choice === 'swap' ? 'Swap' : 'Tunnel'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.cardSub}>{subtitle}</Text>
          </View>
          {tunnel ? null : (
            <Text style={styles.mutedLabel}>{quoting ? 'Quoting…' : stargate ? 'Stargate' : 'Sushi'}</Text>
          )}
        </View>

        {stargateMoves.length > 0 ? (
          <View style={tunnelStyles.moves}>
            {stargateMoves.map(({ move, view }) => (
              <View key={move.id} style={tunnelStyles.card}>
                <Text style={tunnelStyles.cardTitle}>
                  {move.direction === 'to-hemi' ? 'Ethereum → Hemi' : 'Hemi → Ethereum'}
                </Text>
                <Text style={tunnelStyles.fine}>
                  {formatWhen(move.createdAt)} · {formatRawAmount(BigInt(move.amountIn || '0'), 18, 6)} ETH
                </Text>
                <View style={tunnelStyles.stepRow}>
                  <SpinCoin spinning={view.spinning} />
                  <View style={tunnelStyles.stepCopy}>
                    <Text style={tunnelStyles.stepTitle}>{view.step}</Text>
                    <Text style={tunnelStyles.fine}>{view.message}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => { void Linking.openURL(`https://layerzeroscan.com/tx/${move.txHash}`); }}>
                  <Text style={tunnelStyles.actionLink}>LayerZero Scan</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {tunnel ? (
          <HemiTunnelModal
            bare
            visible
            btcAddress={btcAddress}
            hemiAddress={address}
            ledger={ledger}
            onClose={() => {}}
          />
        ) : (
          <>
            <View style={styles.chipRow}>
              {(['stargate', 'sushi'] as const).map((choice) => {
                const on = venue === choice;
                return (
                  <TouchableOpacity
                    key={choice}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => {
                      confirmRef.current = false;
                      trackingHash.current = null;
                      flow.close();
                      setVenue(choice);
                      setAmount('');
                      setError(null);
                      setConfirmOpen(false);
                    }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>
                      {choice === 'stargate' ? 'Stargate' : 'Sushi'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {stargate
                ? 'Stargate moves native ETH between Ethereum and Hemi. The message fee is on top of the amount.'
                : 'Sushi swaps the assets you pick on Hemi. This stays on Hemi. It is not a bridge.'}
            </Text>
            {isLedgerSession() ? (
              <Text style={styles.hint}>The Ethereum app signs this. Turn on Blind signing in that app first.</Text>
            ) : null}

            <View style={styles.panel}>
              <View style={styles.rowBetween}>
                <Text style={styles.mutedLabel}>You pay</Text>
                <TouchableOpacity onPress={fillMax} disabled={availableRaw === 0n}>
                  <Text style={styles.balanceHint}>
                    Available{' '}
                    {availableValue == null ? (
                      <Text style={{ color: defiColors.textSecondary }}>…</Text>
                    ) : (
                      <FormattedNumber value={availableValue} variant="balance" style={styles.balanceHint} />
                    )}
                    {' '}{stargate ? 'ETH' : sushiPay}
                    {stargate ? ` · ${stargateDir === 'to-hemi' ? 'Ethereum' : 'Hemi'}` : ' · Hemi'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={(text) => { setAmount(text.replace(/[^0-9.]/g, '')); setError(null); }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor="#3f3f46"
                />
                <TouchableOpacity style={styles.chip} onPress={fillMax} disabled={availableRaw === 0n}>
                  <Text style={styles.chipText}>MAX</Text>
                </TouchableOpacity>
                <AssetMenu
                  label={stargate ? 'ETH' : sushiPay}
                  icon={stargate ? (stargateDir === 'to-hemi' ? 'ETH' : 'HEMIETH') : undefined}
                  locked={stargate}
                  tokens={tokens}
                  selectedId={sushiPayToken.id}
                  network="hemi"
                  allowAdd={!stargate}
                  onSelect={(token) => choose('pay', token)}
                />
              </View>
            </View>

            <View style={styles.flipWrap}>
              <TouchableOpacity style={styles.flipBtn} onPress={flip}>
                <Text style={{ color: defiColors.textSecondary, fontSize: 16 }}>⇅</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.panel}>
              <View style={styles.rowBetween}>
                <Text style={styles.mutedLabel}>You receive</Text>
                <Text style={styles.balanceHint}>
                  {stargate ? (stargateDir === 'to-hemi' ? 'Hemi' : 'Ethereum') : 'Hemi'}
                </Text>
              </View>
              <View style={styles.amountRow}>
                <Text style={[styles.amountInput, { paddingVertical: 8 }]}>{quoting ? '…' : received}</Text>
                <AssetMenu
                  label={stargate ? 'ETH' : sushiReceive}
                  icon={stargate ? (stargateDir === 'to-hemi' ? 'HEMIETH' : 'ETH') : undefined}
                  locked={stargate}
                  tokens={tokens}
                  selectedId={sushiReceiveToken.id}
                  network="hemi"
                  allowAdd={!stargate}
                  onSelect={(token) => choose('receive', token)}
                />
              </View>
            </View>

            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.mutedLabel}>Minimum</Text>
                <Text style={styles.summaryValue}>{minimum}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.mutedLabel}>{stargate ? 'Message fee' : 'Route'}</Text>
                <Text style={styles.summaryValue}>
                  {stargate
                    ? (stargateQuote ? `${formatRawAmount(stargateQuote.fee, 18, 6)} ETH` : '—')
                    : 'Sushi · Hemi'}
                </Text>
              </View>
              {stargate ? null : (
                <>
                  <Text style={styles.mutedLabel}>Slippage</Text>
                  <View style={styles.chipRow}>
                    {SLIPPAGE.map((choice) => (
                      <TouchableOpacity
                        key={choice.bps}
                        style={[styles.chip, slippageBps === choice.bps && styles.chipActive]}
                        onPress={() => setSlippageBps(choice.bps)}
                      >
                        <Text style={[styles.chipText, slippageBps === choice.bps && styles.chipTextActive]}>
                          {choice.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </View>

            {blockReason ? <Text style={styles.warn}>{blockReason}</Text> : null}
            {error ? <Text style={styles.warn}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.cta, (!quote || Boolean(blockReason) || quoting || flow.busy) && styles.ctaDisabled]}
              disabled={!quote || Boolean(blockReason) || quoting || flow.busy}
              onPress={() => setConfirmOpen(true)}
            >
              <Text style={styles.ctaText}>{venue === 'sushi' && !sushiPayToken.native ? 'Review approval and swap' : 'Review swap'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      <SpendConfirm
        open={confirmOpen && (quote != null || flow.busy || flow.outcome != null) && !tunnel}
        title={stargate ? 'Move ETH with Stargate' : `Swap ${sushiPay} for ${sushiReceive}`}
        confirmLabel={stargate ? 'Move ETH' : !sushiPayToken.native ? 'Approve and swap' : 'Swap'}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        onCancel={() => {
          confirmRef.current = false;
          trackingHash.current = null;
          flow.close(() => {
            setAmount('');
            setStargateQuote(null);
            setSushiQuote(null);
          });
          setConfirmOpen(false);
        }}
        onConfirm={submit}
        rows={stargate ? [
          { label: 'You pay', value: `${amount.trim()} ETH` },
          { label: 'Message fee', value: stargateQuote ? `${formatRawAmount(stargateQuote.fee, 18, 6)} ETH` : '…' },
          { label: 'You receive', value: `${received} ETH` },
          { label: 'Route', value: stargateDir === 'to-hemi' ? 'Ethereum → Hemi · Stargate' : 'Hemi → Ethereum · Stargate' },
          { label: 'Account', value: address },
        ] : [
          { label: 'You pay', value: `${amount.trim()} ${sushiPay}` },
          { label: 'You receive about', value: `${received} ${sushiReceive}` },
          { label: 'Minimum', value: minimum },
          { label: 'Slippage', value: slippageLabel },
          { label: 'Route', value: 'Sushi · Hemi' },
          { label: 'Account', value: address },
        ]}
      />
    </DefiModalShell>
  );
};

export default HemiSwapModal;
