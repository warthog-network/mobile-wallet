import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import DefiModalShell from './DefiModalShell';
import SpendConfirm from '../SpendConfirm';
import TokenIcon from '../TokenIcon';
import { defiColors } from './defiStyles';
import { toast } from '../../utils/toast';
import { formatRawAmount, formatRawAmountFloor, rawToDecimal } from '../../utils/ethHoldings';
import FormattedNumber from '../FormattedNumber';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import {
  executeSushiSwap,
  explainEthError,
  maxSwapEth,
  parseTokenAmount,
  quoteSushiSwap,
  readRawHoldings,
  usdtAllowance,
  type SwapDirection,
  type SwapQuote,
} from '../../utils/ethChain';
import { isLedgerSession } from '../../utils/sessionVault';

interface Props {
  visible: boolean;
  address?: string;
  onClose: () => void;
  /** Reload ETH and USDT after a confirmed swap, or after a failed broadcast spent gas. */
  onBalances: (blockNumber?: number) => void;
}

const SLIPPAGE = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
] as const;

function side(direction: SwapDirection): { pay: 'ETH' | 'USDT'; receive: 'ETH' | 'USDT'; receiveDecimals: number } {
  return direction === 'ETH_TO_USDT'
    ? { pay: 'ETH', receive: 'USDT', receiveDecimals: 6 }
    : { pay: 'USDT', receive: 'ETH', receiveDecimals: 18 };
}

/** USDT per 1 ETH, shown to 4 decimal places. */
function usdtPerEth(quote: SwapQuote): string {
  const usdt = quote.direction === 'ETH_TO_USDT' ? quote.amountOut : quote.amountIn;
  const eth = quote.direction === 'ETH_TO_USDT' ? quote.amountIn : quote.amountOut;
  if (eth <= 0n) return '—';
  const scaled = (usdt * (10n ** 12n) * 10_000n) / eth;
  const whole = scaled / 10_000n;
  const frac = (scaled % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : whole.toString();
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const EthSwapModal: React.FC<Props> = ({ visible, address, onClose, onBalances }) => {
  const [direction, setDirection] = useState<SwapDirection>('ETH_TO_USDT');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [held, setHeld] = useState<{ eth: bigint; usdt: bigint } | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const swapping = useRef(false);

  const { pay, receive, receiveDecimals } = side(direction);
  const hasAccount = Boolean(address);
  const { formatBalance } = useNumberDisplay();

  const reloadHeld = async (nextAddress: string) => {
    const [balances, nextAllowance] = await Promise.all([
      readRawHoldings(nextAddress),
      usdtAllowance(nextAddress),
    ]);
    setHeld(balances);
    setAllowance(nextAllowance);
  };

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setConfirmOpen(false);
    if (!address) {
      setHeld(null);
      setAllowance(null);
      return;
    }
    let cancel = false;
    void readRawHoldings(address)
      .then((next) => { if (!cancel) setHeld(next); })
      .catch((err: unknown) => { if (!cancel) setError(explainEthError(err)); });
    void usdtAllowance(address)
      .then((next) => { if (!cancel) setAllowance(next); })
      .catch(() => { if (!cancel) setAllowance(null); });
    return () => { cancel = true; };
  }, [visible, address]);

  useEffect(() => {
    const text = amount.trim();
    if (!visible || !hasAccount || !text || text === '.' || /^\d+\.$/.test(text)) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    setQuote(null);
    const timer = setTimeout(() => {
      void quoteSushiSwap(direction, amount, slippageBps)
        .then((next) => {
          if (cancel) return;
          setQuote(next);
          setQuoteError(null);
        })
        .catch((err: unknown) => {
          if (cancel) return;
          setQuote(null);
          setQuoteError(explainEthError(err));
        })
        .finally(() => { if (!cancel) setQuoting(false); });
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [visible, hasAccount, direction, amount, slippageBps]);

  const availableRaw = held == null ? null : pay === 'ETH' ? held.eth : held.usdt;
  const availableValue = held == null
    ? null
    : rawToDecimal(pay === 'ETH' ? held.eth : held.usdt, pay === 'ETH' ? 18 : 6);

  let overBalance = false;
  if (availableRaw != null && amount.trim() && amount.trim() !== '.' && !/^\d+\.$/.test(amount.trim())) {
    try {
      overBalance = parseTokenAmount(amount, pay === 'ETH' ? 18 : 6) > availableRaw;
    } catch {
      overBalance = false;
    }
  }

  const fillMax = async () => {
    if (!address) return;
    setError(null);
    try {
      if (pay === 'USDT') {
        const next = held ?? await readRawHoldings(address);
        if (next.usdt <= 0n) throw new Error('This wallet has no USDT.');
        setAmount(formatRawAmountFloor(next.usdt, 6, 6));
        return;
      }
      const max = await maxSwapEth(address);
      if (max <= 0n) throw new Error('Not enough ETH to pay for gas.');
      setAmount(formatRawAmountFloor(max, 18, 6));
    } catch (err: unknown) {
      setError(explainEthError(err));
    }
  };

  const flip = () => {
    setDirection((current) => (current === 'ETH_TO_USDT' ? 'USDT_TO_ETH' : 'ETH_TO_USDT'));
    setAmount('');
    setQuote(null);
    setError(null);
  };

  const needsApproval = Boolean(
    quote && direction === 'USDT_TO_ETH' && (allowance == null || allowance < quote.amountIn),
  );

  const blockReason = !hasAccount
    ? null
    : overBalance
      ? `Only ${availableValue == null ? '0' : formatBalance(availableValue)} ${pay} is free in this wallet.`
      : quoteError
        ? quoteError
        : amount.trim() && !quote && !quoting
          ? 'Enter an amount SushiSwap can price.'
          : null;

  const swap = () => {
    if (!quote || !address || swapping.current) return;
    swapping.current = true;
    const currentQuote = quote;
    const account = address;
    const payLabel = pay;
    const receiveLabel = receive;
    setConfirmOpen(false);
    setAmount('');
    setQuote(null);
    setError(null);
    onClose();
    // Let the card finish closing before the toast, so the spinner is not stuck under the sheet.
    setTimeout(() => {
      const id = toast.loading('Swapping', `${payLabel} for ${receiveLabel} on Ethereum…`);
      void (async () => {
        try {
          const result = await executeSushiSwap(currentQuote, (text) => {
            toast.update(id, 'loading', 'Swapping', text);
          });
          toast.update(id, 'success', 'Swapped', `${payLabel} for ${receiveLabel} is confirmed.`);
          onBalances(result.blockNumber);
          try {
            await reloadHeld(account);
          } catch {
            // The home card reloads from the confirmed block even if this second read fails.
          }
        } catch (err: unknown) {
          toast.update(id, 'error', 'Swap failed', explainEthError(err));
          onBalances();
        } finally {
          swapping.current = false;
        }
      })();
    }, 320);
  };

  const received = quote ? formatRawAmount(quote.amountOut, receiveDecimals, 6) : '0';
  const minimum = quote ? `${formatRawAmount(quote.amountOutMin, receiveDecimals, 6)} ${receive}` : '—';
  const slippageLabel = SLIPPAGE.find((choice) => choice.bps === slippageBps)?.label ?? `${slippageBps / 100}%`;

  const TokenPill = ({ ticker }: { ticker: 'ETH' | 'USDT' }) => (
    <View style={styles.tokenPill}>
      <TokenIcon symbol={ticker} size={22} />
      <Text style={styles.tokenPillText}>{ticker}</Text>
    </View>
  );

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Swap"
      subtitle="SushiSwap · Ethereum mainnet. Gas is paid in ETH."
    >
      {!hasAccount ? (
        <Text style={styles.hint}>
          This wallet has no Ethereum account yet. A recovery phrase includes one. On a Ledger, add it from the home screen with the Ethereum app open.
        </Text>
      ) : (
        <View style={styles.swapCard}>
          {isLedgerSession() ? (
            <Text style={styles.hint}>
              The Ethereum app approves this swap. Turn on Blind signing in that app first.
            </Text>
          ) : null}
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Swap</Text>
              <Text style={styles.cardSub}>{pay} → {receive}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {quote ? (
                <>
                  <Text style={styles.spotLabel}>PRICE</Text>
                  <Text style={styles.spotValue}>
                    {usdtPerEth(quote)} <Text style={styles.mutedLabel}>USDT</Text>
                  </Text>
                </>
              ) : (
                <Text style={styles.mutedLabel}>{quoting ? 'Quoting…' : 'SushiSwap'}</Text>
              )}
            </View>
          </View>

          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedLabel}>You pay</Text>
              <TouchableOpacity onPress={() => { void fillMax(); }} disabled={availableRaw === 0n}>
                <Text style={styles.balanceHint}>
                  Available{' '}
                  {availableValue == null ? (
                    <Text style={{ color: defiColors.textSecondary }}>…</Text>
                  ) : (
                    <FormattedNumber value={availableValue} variant="balance" style={styles.balanceHint} />
                  )}
                  {' '}{pay}
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
              <TouchableOpacity style={styles.chip} onPress={() => { void fillMax(); }} disabled={availableRaw === 0n}>
                <Text style={styles.chipText}>MAX</Text>
              </TouchableOpacity>
              <TokenPill ticker={pay} />
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
              <Text style={styles.balanceHint}>Estimate · after slippage</Text>
            </View>
            <View style={styles.amountRow}>
              <Text style={[styles.amountInput, { paddingVertical: 8 }]}>{quoting ? '…' : received}</Text>
              <TokenPill ticker={receive} />
            </View>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.mutedLabel}>Minimum</Text>
              <Text style={styles.summaryValue}>{minimum}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.mutedLabel}>Network</Text>
              <Text style={styles.summaryValue}>Ethereum · gas in ETH</Text>
            </View>
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
          </View>

          {needsApproval ? (
            <Text style={styles.hint}>
              USDT needs an approval before the swap. That is a separate Ethereum transaction and spends a little ETH for gas.
            </Text>
          ) : null}
          {blockReason ? <Text style={styles.warn}>{blockReason}</Text> : null}
          {error ? <Text style={styles.warn}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.cta, (!quote || Boolean(blockReason) || quoting) && styles.ctaDisabled]}
            disabled={!quote || Boolean(blockReason) || quoting}
            onPress={() => setConfirmOpen(true)}
          >
            <Text style={styles.ctaText}>{needsApproval ? 'Review approval and swap' : 'Review swap'}</Text>
          </TouchableOpacity>
        </View>
      )}
      <SpendConfirm
        open={confirmOpen && quote != null}
        title="Swap on SushiSwap"
        confirmLabel={needsApproval ? 'Approve and swap' : 'Swap'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={swap}
        rows={[
          { label: 'You pay', value: `${amount.trim()} ${pay}` },
          { label: 'You receive about', value: `${received} ${receive}` },
          { label: 'Minimum', value: minimum },
          { label: 'Slippage', value: slippageLabel },
          { label: 'Pool', value: 'SushiSwap ETH / USDT' },
          { label: 'Account', value: address || '' },
        ]}
      />
    </DefiModalShell>
  );
};

const styles = {
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
  tokenPillText: {
    color: '#fafafa',
    fontSize: 13,
    fontWeight: '600' as const,
  },
  chipRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
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
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  warn: {
    color: defiColors.amberText,
    fontSize: 12,
    lineHeight: 16,
  },
};

export default EthSwapModal;
