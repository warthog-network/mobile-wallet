import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import DefiModalShell from './DefiModalShell';
import { EthMoveList, EthTunnelForm } from './EthTunnelForm';
import JupBridgeForm from './JupBridgeForm';
import AaveModal from './AaveModal';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { formatRawAmount, formatRawAmountFloor, rawToDecimal } from '../../utils/ethHoldings';
import FormattedNumber from '../FormattedNumber';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import {
  executeSushiPair,
  explainEthError,
  maxSwapEth,
  parseTokenAmount,
  quoteSushiPair,
  routerAllowance,
  type SushiLeg,
  type SushiPairQuote,
} from '../../utils/ethChain';
import { ETH_WETH } from '../../utils/ethTokens';
import { readOneBalance } from '../../utils/tokenBalances';
import { isLedgerSession } from '../../utils/sessionVault';
import AssetMenu from './AssetMenu';
import { useWalletTokens } from './useWalletTokens';
import type { WalletToken } from '../../utils/walletTokens';

interface Props {
  visible: boolean;
  address?: string;
  onClose: () => void;
  /** Reload ETH and USDT after a confirmed swap, or after a failed broadcast spent gas. */
  onBalances: (blockNumber?: number) => void;
  /** Draw the swap card on the page. The Swap tab uses this for Ethereum. */
  embedded?: boolean;
  /** Solana account on this phrase wallet. Tunnel can then quote ETH ↔ SOL. */
  solAddress?: string;
  /** Reload Solana after a SOL-side bridge. */
  onSolana?: () => void;
}

const SLIPPAGE = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
] as const;

function sushiLeg(token: WalletToken): SushiLeg {
  return {
    symbol: token.symbol,
    address: token.native ? ETH_WETH : token.address,
    decimals: token.decimals,
    native: token.native,
  };
}

/** Receive units for one unit paid. */
function rate(quote: SushiPairQuote): string {
  if (quote.amountIn <= 0n) return '—';
  const scale = 10_000n;
  const scaled = (quote.amountOut * scale * (10n ** BigInt(quote.pay.decimals)))
    / (quote.amountIn * (10n ** BigInt(quote.receive.decimals)));
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(4, '0').replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : whole.toString();
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const EthSwapModal: React.FC<Props> = ({
  visible,
  address,
  onClose,
  onBalances,
  embedded = false,
  solAddress,
  onSolana,
}) => {
  const [panel, setPanel] = useState<'swap' | 'tunnel'>('swap');
  const [tunnelAsset, setTunnelAsset] = useState<'hemi' | 'sol'>('hemi');
  const [ethTick, setEthTick] = useState(0);
  const [aaveOpen, setAaveOpen] = useState(false);
  const { tokens } = useWalletTokens('ethereum');
  const [pay, setPay] = useState<WalletToken>(tokens[0]);
  const [receive, setReceive] = useState<WalletToken>(tokens.find((token) => token.symbol === 'USDT') ?? tokens[1]);

  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [held, setHeld] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<SushiPairQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const flow = useSpendFlow();
  const swapping = useRef(false);

  const hasAccount = Boolean(address);
  const tunnel = hasAccount && panel === 'tunnel';
  const { formatBalance } = useNumberDisplay();

  const reloadHeld = async (nextAddress: string, token: WalletToken) => {
    const balance = await readOneBalance('ethereum', nextAddress, token);
    setHeld(balance);
    if (token.native) {
      setAllowance(null);
      return;
    }
    setAllowance(await routerAllowance(token.address, nextAddress));
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
    void reloadHeld(address, pay).catch((err: unknown) => {
      if (!cancel) setError(explainEthError(err));
    });
    return () => { cancel = true; };
  }, [visible, address, pay]);

  useEffect(() => {
    const text = amount.trim();
    if (!visible || tunnel || !hasAccount || !text || text === '.' || /^\d+\.$/.test(text) || pay.id === receive.id) {
      setQuote(null);
      setQuoteError(null);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    setQuote(null);
    let raw: bigint;
    try {
      raw = parseTokenAmount(amount, pay.decimals);
    } catch {
      setQuoting(false);
      return;
    }
    const timer = setTimeout(() => {
      void quoteSushiPair(sushiLeg(pay), sushiLeg(receive), raw, slippageBps)
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
  }, [visible, tunnel, hasAccount, pay, receive, amount, slippageBps]);

  const availableRaw = held;
  const availableValue = held == null ? null : rawToDecimal(held, pay.decimals);

  let overBalance = false;
  if (availableRaw != null && amount.trim() && amount.trim() !== '.' && !/^\d+\.$/.test(amount.trim())) {
    try {
      overBalance = parseTokenAmount(amount, pay.decimals) > availableRaw;
    } catch {
      overBalance = false;
    }
  }

  const fillMax = async () => {
    if (!address) return;
    setError(null);
    try {
      if (!pay.native) {
        const next = held ?? await readOneBalance('ethereum', address, pay);
        if (next <= 0n) throw new Error(`This wallet has no ${pay.symbol}.`);
        setAmount(formatRawAmountFloor(next, pay.decimals, 6));
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
    setPay(receive);
    setReceive(pay);
    setAmount('');
    setQuote(null);
    setError(null);
  };

  const choose = (side: 'pay' | 'receive', token: WalletToken) => {
    if (side === 'pay') {
      if (token.id === receive.id) setReceive(pay);
      setPay(token);
    } else {
      if (token.id === pay.id) setPay(receive);
      setReceive(token);
    }
    setAmount('');
    setQuote(null);
    setError(null);
  };

  const needsApproval = Boolean(
    quote && !pay.native && (allowance == null || allowance < quote.amountIn),
  );

  const blockReason = !hasAccount
    ? null
    : overBalance
      ? `Only ${availableValue == null ? '0' : formatBalance(availableValue)} ${pay.symbol} is free in this wallet.`
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
    const payLabel = pay.symbol;
    const receiveLabel = receive.symbol;
    const paid = amount.trim();
    setError(null);
    flow.begin(needsApproval
      ? `Approving ${payLabel}, then swapping for ${receiveLabel}…`
      : `Swapping ${paid} ${payLabel} for ${receiveLabel}…`);
    void (async () => {
      try {
        const result = await executeSushiPair(currentQuote, (text) => flow.setStep(text));
        flow.finish(true, 'Swapped', `${paid} ${payLabel} for ${receiveLabel} is confirmed on Ethereum.`);
        onBalances(result.blockNumber);
        try {
          await reloadHeld(account, pay);
        } catch {
          // The home card reloads from the confirmed block even if this second read fails.
        }
      } catch (err: unknown) {
        const message = explainEthError(err);
        setError(message);
        flow.finish(false, 'Swap failed', message);
        onBalances();
      } finally {
        swapping.current = false;
      }
    })();
  };

  const received = quote ? formatRawAmount(quote.amountOut, receive.decimals, 6) : '0';
  const minimum = quote ? `${formatRawAmount(quote.amountOutMin, receive.decimals, 6)} ${receive.symbol}` : '—';
  const slippageLabel = SLIPPAGE.find((choice) => choice.bps === slippageBps)?.label ?? `${slippageBps / 100}%`;

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Swap"
      subtitle="SushiSwap · Ethereum mainnet. Gas is paid in ETH."
      embedded={embedded}
      showClose={!embedded}
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
            <View style={{ flex: 1, gap: 6 }}>
              <View style={styles.chipRow}>
                {(['swap', 'tunnel'] as const).map((choice) => {
                  const on = choice === 'tunnel' ? tunnel : !tunnel;
                  return (
                    <TouchableOpacity
                      key={choice}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => { setPanel(choice); setConfirmOpen(false); }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>
                        {choice === 'swap' ? 'Swap' : 'Tunnel'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={styles.chip} onPress={() => setAaveOpen(true)}>
                  <Text style={styles.chipText}>Aave</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.cardSub}>
                {tunnel ? (tunnelAsset === 'sol' ? 'ETH ↔ SOL' : 'ETH ↔ Hemi') : `${pay.symbol} → ${receive.symbol}`}
              </Text>
            </View>
            {tunnel ? null : (
            <View style={{ alignItems: 'flex-end' }}>
              {quote ? (
                <>
                  <Text style={styles.spotLabel}>PRICE</Text>
                  <Text style={styles.spotValue}>
                    {rate(quote)} <Text style={styles.mutedLabel}>{receive.symbol}</Text>
                  </Text>
                </>
              ) : (
                <Text style={styles.mutedLabel}>{quoting ? 'Quoting…' : 'SushiSwap'}</Text>
              )}
            </View>
            )}
          </View>

          {tunnel && address && solAddress ? (
            <View style={styles.chipRow}>
              {(['hemi', 'sol'] as const).map((choice) => {
                const on = tunnelAsset === choice;
                return (
                  <TouchableOpacity
                    key={choice}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => setTunnelAsset(choice)}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>
                      {choice === 'hemi' ? 'Hemi' : 'Solana'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {tunnel && address && tunnelAsset === 'hemi' ? (
            <>
              <EthMoveList visible={visible} address={address} tick={ethTick} />
              <EthTunnelForm
                address={address}
                ledger={isLedgerSession()}
                onSent={() => { setEthTick((n) => n + 1); onBalances(); }}
              />
            </>
          ) : null}

          {tunnel && address && solAddress && tunnelAsset === 'sol' ? (
            <JupBridgeForm
              ethAddress={address}
              solAddress={solAddress}
              initialDirection="eth-to-sol"
              onSent={() => { onBalances(); onSolana?.(); }}
            />
          ) : null}

          {tunnel ? null : (
          <>
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
                  {' '}{pay.symbol}
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
              <AssetMenu
                label={pay.symbol}
                tokens={tokens}
                selectedId={pay.id}
                network="ethereum"
                allowAdd
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
              <Text style={styles.balanceHint}>Estimate · after slippage</Text>
            </View>
            <View style={styles.amountRow}>
              <Text style={[styles.amountInput, { paddingVertical: 8 }]}>{quoting ? '…' : received}</Text>
              <AssetMenu
                label={receive.symbol}
                tokens={tokens}
                selectedId={receive.id}
                network="ethereum"
                allowAdd
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
              {pay.symbol} needs an approval before the swap. That is a separate Ethereum transaction and spends a little ETH for gas.
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
          </>
          )}
        </View>
      )}
      <AaveModal
        visible={aaveOpen}
        address={address}
        onClose={() => setAaveOpen(false)}
        onChanged={() => onBalances()}
      />
      <SpendConfirm
        open={confirmOpen && (quote != null || flow.busy || flow.outcome != null)}
        title="Swap on SushiSwap"
        confirmLabel={needsApproval ? 'Approve and swap' : 'Swap'}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        onCancel={() => {
          flow.close(() => {
            setAmount('');
            setQuote(null);
          });
          setConfirmOpen(false);
        }}
        onConfirm={swap}
        rows={[
          { label: 'You pay', value: `${amount.trim()} ${pay.symbol}` },
          { label: 'You receive about', value: `${received} ${receive.symbol}` },
          { label: 'Minimum', value: minimum },
          { label: 'Slippage', value: slippageLabel },
          { label: 'Pool', value: `SushiSwap ${pay.symbol} / ${receive.symbol}` },
          { label: 'Account', value: address || '' },
        ]}
      />
    </DefiModalShell>
  );
};

export default EthSwapModal;
