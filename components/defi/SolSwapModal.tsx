import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import DefiModalShell from './DefiModalShell';
import LifiSwapCard from './LifiSwapCard';
import JupBridgeForm from './JupBridgeForm';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import FormattedNumber from '../FormattedNumber';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { explainChainError } from '../../utils/networks/http';
import { formatSol, solTxUrl } from '../../utils/networks/solana';
import {
  BRIDGE_ETH,
  BRIDGE_SOL,
  executeJupBridge,
  formatBridgeAmount,
  parseBridgeAmount,
  quoteJupBridge,
  type JupBridgeProvider,
  type JupBridgeRoute,
} from '../../utils/networks/jupBridge';
import { ethTxUrl } from '../../utils/networks/ethBridge';
import { formatRawAmount, formatRawAmountFloor } from '../../utils/ethHoldings';
import { readRawHoldings } from '../../utils/ethChain';
import {
  executeSwap,
  formatAssetAmount,
  quoteSwapAssets,
  type SwapAsset,
  type SwapQuote,
} from '../../utils/networks/solswap';
import { WSOL_MINT } from '../../utils/networks/chains';
import { parseUnits } from '../../utils/networks/units';
import { readOneBalance } from '../../utils/tokenBalances';
import AssetMenu from './AssetMenu';
import { useWalletTokens } from './useWalletTokens';
import type { WalletToken } from '../../utils/walletTokens';
import { isLedgerSession } from '../../utils/sessionVault';

interface Props {
  visible: boolean;
  address: string;
  onClose: () => void;
  onSent: () => void;
  /** Draw the swap card on the page for the Solana chain. */
  embedded?: boolean;
  /** Present when this wallet can also move Bitcoin. */
  btcAddress?: string;
  /** Ethereum account on this wallet. ETH ↔ SOL uses the Jupiter bridge. */
  ethAddress?: string;
  /** Reload the Ethereum balance after an ETH → SOL bridge. */
  onEthereum?: () => void;
}

const BRIDGE_SOL_RESERVE = 20_000_000n;
const BRIDGE_ETH_RESERVE = 3_000_000_000_000_000n;
const SLIPPAGE = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
] as const;

function assetOf(token: WalletToken): SwapAsset {
  return {
    symbol: token.symbol,
    mint: token.native ? WSOL_MINT : token.address,
    decimals: token.decimals,
    native: token.native,
  };
}

/** Receive units for one unit paid, from the Jupiter quote. */
function perPay(quote: SwapQuote, pay: SwapAsset, receive: SwapAsset): string {
  const inRaw = BigInt(quote.raw.inAmount);
  if (inRaw <= 0n) return '—';
  const inDec = pay.decimals;
  const outDec = receive.decimals;
  const scale = 1_000_000n;
  const scaled = (quote.outAmount * scale * (10n ** BigInt(inDec))) / (inRaw * (10n ** BigInt(outDec)));
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(6, '0').replace(/0+$/, '');
  const text = frac ? `${whole}.${frac}` : whole.toString();
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const SolSwapModal: React.FC<Props> = ({
  visible,
  address,
  onClose,
  onSent,
  embedded = false,
  btcAddress,
  ethAddress,
  onEthereum,
}) => {
  const [panel, setPanel] = useState<'swap' | 'tunnel'>('swap');
  const [tunnelAsset, setTunnelAsset] = useState<'btc' | 'eth'>(btcAddress ? 'btc' : 'eth');
  const [bridge, setBridge] = useState<'eth-to-sol' | 'sol-to-eth' | null>(null);
  const [ethRaw, setEthRaw] = useState<bigint | null>(null);
  const [bridgeRoutes, setBridgeRoutes] = useState<JupBridgeRoute[]>([]);
  const [bridgeProvider, setBridgeProvider] = useState<JupBridgeProvider | null>(null);
  const { tokens } = useWalletTokens('solana');
  const [payToken, setPayToken] = useState<WalletToken>(tokens[0]);
  const [receiveToken, setReceiveToken] = useState<WalletToken>(
    tokens.find((token) => token.symbol === 'USDC') ?? tokens[1],
  );

  const [rawById, setRawById] = useState<Record<string, bigint>>({});
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const swapping = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const payAsset = assetOf(payToken);
  const receiveAsset = assetOf(receiveToken);
  const canTunnel = Boolean(btcAddress || ethAddress);
  const tunnel = canTunnel && panel === 'tunnel';
  const showBtcTunnel = tunnel && Boolean(btcAddress) && tunnelAsset === 'btc';
  const showEthTunnel = tunnel && Boolean(ethAddress) && (tunnelAsset === 'eth' || !btcAddress);

  const loadBalances = async () => {
    const entries = await Promise.all(tokens.map(async (token) => {
      try {
        return [token.id, await readOneBalance('solana', address, token)] as const;
      } catch {
        return [token.id, null] as const;
      }
    }));
    setRawById((prev) => {
      const next = { ...prev };
      entries.forEach(([id, raw]) => {
        if (raw != null) next[id] = raw;
      });
      return next;
    });
    setBalances((prev) => {
      const next = { ...prev };
      entries.forEach(([id, raw]) => {
        if (raw == null) return;
        const token = tokens.find((item) => item.id === id);
        next[id] = token?.native ? formatSol(raw) : formatAssetAmount(raw, token?.decimals ?? 0);
      });
      return next;
    });
  };

  useEffect(() => {
    if (!visible) return;
    setAmount('');
    setQuote(null);
    setError(null);
    setTxUrl(null);
    setConfirmOpen(false);
    let cancel = false;
    void loadBalances().catch((err: unknown) => {
      if (!cancel) setError(explainChainError(err));
    });
    if (ethAddress) {
      void readRawHoldings(ethAddress)
        .then((held) => { if (!cancel) setEthRaw(held.eth); })
        .catch(() => { if (!cancel) setEthRaw(null); });
    } else {
      setEthRaw(null);
    }
    return () => { cancel = true; };
  }, [visible, address, ethAddress, tokens]);

  useEffect(() => {
    if (!visible || tunnel || bridge) {
      setQuoting(false);
      if (bridge || tunnel) setQuote(null);
      return;
    }
    setQuote(null);
    if (!amount.trim()) {
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (async () => {
        let raw: bigint;
        try {
          raw = parseUnits(amount, payToken.decimals, payToken.symbol);
        } catch {
          if (!cancel) setQuoting(false);
          return;
        }
        try {
          const have = rawById[payToken.id];
          if (have != null && raw > have) {
            if (!cancel) {
              setError(`Only ${balances[payToken.id] ?? '0'} ${payToken.symbol} is available.`);
              setQuoting(false);
            }
            return;
          }
          const next = await quoteSwapAssets(payAsset, receiveAsset, raw, slippage);
          if (!cancel) {
            setError(null);
            setQuote(next);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setQuote(null);
            setError(explainChainError(err));
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
  }, [amount, payToken, receiveToken, slippage, visible, rawById, balances, tunnel, bridge]);

  useEffect(() => {
    if (!visible || tunnel || !bridge || !ethAddress) {
      setBridgeRoutes([]);
      setBridgeProvider(null);
      return;
    }
    if (!amount.trim()) {
      setBridgeRoutes([]);
      setBridgeProvider(null);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const pay = bridge === 'eth-to-sol' ? BRIDGE_ETH : BRIDGE_SOL;
          const receive = bridge === 'eth-to-sol' ? BRIDGE_SOL : BRIDGE_ETH;
          const raw = parseBridgeAmount(amount, pay);
          const next = await quoteJupBridge({
            pay,
            receive,
            amountIn: raw,
            ethAddress,
            solAddress: address,
            slippageBps: slippage,
          });
          if (cancel) return;
          setBridgeRoutes(next);
          setBridgeProvider((current) => (
            current && next.some((row) => row.provider === current) ? current : next[0].provider
          ));
          const solToken = tokens.find((token) => token.native);
          const held = bridge === 'eth-to-sol' ? ethRaw : (solToken ? rawById[solToken.id] ?? null : null);
          if (held != null && raw > held) {
            const have = bridge === 'eth-to-sol' ? formatRawAmount(held, 18, 6) : formatSol(held);
            setError(`This route needs ${amount.trim()} ${pay.symbol}. This wallet has ${have}.`);
          } else {
            setError(null);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setBridgeRoutes([]);
            setBridgeProvider(null);
            setError(explainChainError(err));
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
  }, [amount, bridge, tunnel, visible, ethAddress, address, ethRaw, rawById, tokens, slippage]);

  const clearQuote = () => {
    setAmount('');
    setQuote(null);
    setBridgeRoutes([]);
    setBridgeProvider(null);
    setError(null);
    setConfirmOpen(false);
  };

  const chooseToken = (side: 'pay' | 'receive', token: WalletToken) => {
    clearQuote();
    setBridge(null);
    if (side === 'pay') {
      if (token.id === receiveToken.id) setReceiveToken(payToken);
      setPayToken(token);
      return;
    }
    if (token.id === payToken.id) setPayToken(receiveToken);
    setReceiveToken(token);
  };

  const chooseEth = (side: 'pay' | 'receive') => {
    clearQuote();
    if (!ethAddress) return;
    if (side === 'receive' && !payToken.native) {
      setError('Use the Tunnel pill to bridge that token to Ethereum.');
      return;
    }
    setBridge(side === 'pay' ? 'eth-to-sol' : 'sol-to-eth');
    if (side === 'pay') {
      const sol = tokens.find((token) => token.native);
      if (sol) setReceiveToken(sol);
    }
  };

  const flip = () => {
    clearQuote();
    if (bridge === 'eth-to-sol') {
      setBridge('sol-to-eth');
      const sol = tokens.find((token) => token.native);
      if (sol) setPayToken(sol);
      return;
    }
    if (bridge === 'sol-to-eth') {
      setBridge('eth-to-sol');
      return;
    }
    setPayToken(receiveToken);
    setReceiveToken(payToken);
  };

  const fillMax = () => {
    if (bridge === 'eth-to-sol') {
      if (ethRaw == null) return;
      const max = ethRaw > BRIDGE_ETH_RESERVE ? ethRaw - BRIDGE_ETH_RESERVE : 0n;
      if (max <= 0n) {
        setError('Not enough ETH for the bridge and the network fee.');
        return;
      }
      setAmount(formatRawAmountFloor(max, 18, 6));
      setError(null);
      return;
    }
    if (bridge === 'sol-to-eth') {
      const sol = tokens.find((token) => token.native);
      const raw = sol ? rawById[sol.id] : undefined;
      if (raw == null) return;
      const max = raw > BRIDGE_SOL_RESERVE ? raw - BRIDGE_SOL_RESERVE : 0n;
      if (max <= 0n) {
        setError('Keep a little SOL for the network fee.');
        return;
      }
      setAmount(formatAssetAmount(max, 9));
      setError(null);
      return;
    }
    const raw = rawById[payToken.id];
    if (raw == null) return;
    const reserve = payToken.native ? 10_000_000n : 0n;
    const max = raw > reserve ? raw - reserve : 0n;
    if (max <= 0n) {
      setError(payToken.native ? 'Keep a little SOL for fees and the token account.' : `No ${payToken.symbol} to swap.`);
      return;
    }
    setAmount(formatAssetAmount(max, payToken.decimals));
    setError(null);
  };

  const submitBridge = async () => {
    const current = bridgeRoutes.find((row) => row.provider === bridgeProvider);
    if (!current || !bridge || !ethAddress || swapping.current) return;
    swapping.current = true;
    setError(null);
    const direction = bridge;
    flow.begin(`Bridging ${amount.trim()} ${current.pay.symbol} to ${current.receive.symbol} with ${current.label}…`);
    try {
      const hash = await executeJupBridge(current, ethAddress, address);
      setTxUrl(direction === 'eth-to-sol' ? ethTxUrl(hash) : solTxUrl(hash));
      flow.finish(true, 'Bridge sent', `${current.label} has the transfer. The other chain pays this wallet.`);
      if (direction === 'eth-to-sol') onEthereum?.();
      else onSent();
      await loadBalances();
      if (ethAddress) {
        const held = await readRawHoldings(ethAddress);
        setEthRaw(held.eth);
      }
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      flow.finish(false, 'Bridge failed', message);
    } finally {
      swapping.current = false;
    }
  };

  const submit = async () => {
    if (!quote || bridge || swapping.current) return;
    swapping.current = true;
    setError(null);
    const payLabel = payToken.symbol;
    const receiveLabel = receiveToken.symbol;
    const paid = amount.trim();
    const current = quote.raw;
    flow.begin(`Swapping ${paid} ${payLabel} for ${receiveLabel} on Solana…`);
    try {
      flow.setStep('Waiting for Solana to confirm…');
      const tx = await executeSwap(address, current);
      setTxUrl(solTxUrl(tx.signature));
      flow.finish(true, 'Swapped', `${paid} ${payLabel} for ${receiveLabel} is on Solana.`);
      await loadBalances();
      onSent();
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      flow.finish(false, 'Swap failed', message);
    } finally {
      swapping.current = false;
    }
  };

  const shownPay = bridge === 'eth-to-sol' ? 'ETH' : bridge === 'sol-to-eth' ? 'SOL' : payToken.symbol;
  const shownReceive = bridge === 'eth-to-sol' ? 'SOL' : bridge === 'sol-to-eth' ? 'ETH' : receiveToken.symbol;
  const solRaw = rawById[tokens.find((token) => token.native)?.id || ''] ?? 0n;
  const availableRaw = bridge === 'eth-to-sol' ? (ethRaw ?? 0n) : bridge === 'sol-to-eth' ? solRaw : (rawById[payToken.id] ?? 0n);
  const availableText = bridge === 'eth-to-sol'
    ? (ethRaw == null ? null : formatRawAmount(ethRaw, 18, 6))
    : bridge === 'sol-to-eth'
      ? formatSol(solRaw)
      : (balances[payToken.id] ?? null);
  const bridgeRoute = bridgeRoutes.find((row) => row.provider === bridgeProvider) ?? null;
  const bridgeOutDecimals = bridge === 'eth-to-sol' ? 9 : 18;
  const received = bridge
    ? (bridgeRoute ? formatBridgeAmount(bridgeRoute.expectedOut, bridgeOutDecimals) : '0')
    : (quote ? quote.outText : '0');
  const minimum = bridge
    ? (bridgeRoute ? `${formatBridgeAmount(bridgeRoute.minOut, bridgeOutDecimals)} ${shownReceive}` : '—')
    : (quote ? `${quote.minimumText} ${receiveToken.symbol}` : '—');
  const slippageLabel = SLIPPAGE.find((choice) => choice.bps === slippage)?.label ?? `${slippage / 100}%`;
  const canReview = bridge ? Boolean(bridgeRoute) && !error : Boolean(quote);

  const ethExtra = ethAddress
    ? [{ id: 'eth', symbol: 'ETH', name: 'Ether on Ethereum · Jupiter' }]
    : undefined;

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Swap"
      subtitle="Jupiter · Solana. Pick the asset you receive."
      embedded={embedded}
      showClose={!embedded}
    >
      <View style={styles.swapCard}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, gap: 6 }}>
            {canTunnel ? (
              <View style={styles.chipRow}>
                {(['swap', 'tunnel'] as const).map((choice) => {
                  const on = choice === 'tunnel' ? tunnel : !tunnel;
                  const label = choice === 'swap' ? 'Swap' : 'Tunnel';
                  return (
                    <TouchableOpacity
                      key={choice}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() => { setPanel(choice); setConfirmOpen(false); }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.cardTitle}>Swap</Text>
            )}
            <Text style={styles.cardSub}>
              {showEthTunnel ? 'ETH ↔ SOL' : tunnel ? 'SOL ↔ BTC' : `${shownPay} → ${shownReceive}`}
            </Text>
          </View>
          {tunnel ? null : (
            <View style={{ alignItems: 'flex-end' }}>
              {bridge ? (
                <Text style={styles.mutedLabel}>{quoting ? 'Quoting…' : (bridgeRoute?.label ?? 'Jupiter')}</Text>
              ) : quote ? (
                <>
                  <Text style={styles.spotLabel}>PRICE</Text>
                  <Text style={styles.spotValue}>
                    {perPay(quote, payAsset, receiveAsset)} <Text style={styles.mutedLabel}>{receiveToken.symbol}</Text>
                  </Text>
                </>
              ) : (
                <Text style={styles.mutedLabel}>{quoting ? 'Quoting…' : 'Jupiter'}</Text>
              )}
            </View>
          )}
        </View>

        {isLedgerSession() ? (
          <Text style={styles.hint}>
            The Solana app signs swaps and the Solana side of a tunnel. Turn on Blind signing for those. Ethereum still uses the Ethereum app. Bitcoin uses the Bitcoin app.
          </Text>
        ) : null}

        {tunnel && btcAddress && ethAddress ? (
          <View style={styles.chipRow}>
            {(['btc', 'eth'] as const).map((choice) => {
              const on = tunnelAsset === choice;
              return (
                <TouchableOpacity
                  key={choice}
                  style={[styles.chip, on && styles.chipActive]}
                  onPress={() => { setTunnelAsset(choice); setConfirmOpen(false); }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>
                    {choice === 'btc' ? 'Bitcoin' : 'Ethereum'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {btcAddress ? (
          <LifiSwapCard
            bare
            visible={visible && !showEthTunnel}
            showForm={showBtcTunnel}
            solAddress={address}
            btcAddress={btcAddress}
            onSent={onSent}
          />
        ) : null}

        {showEthTunnel ? (
          <JupBridgeForm
            ethAddress={ethAddress as string}
            solAddress={address}
            initialDirection="sol-to-eth"
            onSent={(dir) => {
              if (dir === 'eth-to-sol') onEthereum?.();
              else onSent();
            }}
          />
        ) : null}

        {tunnel ? null : (
        <>
        {bridgeRoutes.length > 0 ? (
          <View style={styles.chipRow}>
            {bridgeRoutes.map((route) => {
              const on = route.provider === bridgeRoute?.provider;
              return (
                <TouchableOpacity
                  key={route.provider}
                  style={[styles.chip, on && styles.chipActive]}
                  onPress={() => { setBridgeProvider(route.provider); setConfirmOpen(false); }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{route.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        {ethAddress && !bridge ? (
          <Text style={styles.hint}>ETH in the asset menu bridges with Jupiter, the same routes as edge.jup.ag/bridge.</Text>
        ) : null}
        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.mutedLabel}>You pay</Text>
            <TouchableOpacity onPress={fillMax} disabled={availableRaw === 0n}>
              <Text style={styles.balanceHint}>
                Available{' '}
                {availableText == null ? (
                  <Text style={{ color: defiColors.textSecondary }}>…</Text>
                ) : (
                  <FormattedNumber value={availableText} variant="balance" style={styles.balanceHint} />
                )}
                {' '}{shownPay}
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
              label={shownPay}
              tokens={tokens}
              balances={balances}
              selectedId={bridge === 'eth-to-sol' ? undefined : payToken.id}
              selectedExtraId={bridge === 'eth-to-sol' ? 'eth' : undefined}
              extra={ethExtra}
              onExtra={() => chooseEth('pay')}
              network="solana"
              allowAdd
              onSelect={(token) => chooseToken('pay', token)}
            />
          </View>
          {bridge ? (
            <Text style={[styles.hint, { marginTop: 8, marginBottom: 0 }]}>
              Jupiter bridge · Relay or Mayan, the same routes as edge.jup.ag/bridge. Ethereum needs about $10. It arrives in this wallet.
            </Text>
          ) : payToken.native && !bridge ? (
            <Text style={[styles.hint, { marginTop: 8, marginBottom: 0 }]}>
              Max leaves 0.01 SOL for fees and a token account.
            </Text>
          ) : null}
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
              label={shownReceive}
              tokens={tokens}
              balances={balances}
              selectedId={bridge === 'sol-to-eth' ? undefined : receiveToken.id}
              selectedExtraId={bridge === 'sol-to-eth' ? 'eth' : undefined}
              extra={ethExtra}
              onExtra={() => chooseEth('receive')}
              network="solana"
              allowAdd
              onSelect={(token) => chooseToken('receive', token)}
            />
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Minimum</Text>
            <Text style={styles.summaryValue}>{minimum}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Route</Text>
            <Text style={styles.summaryValue}>{bridge ? (bridgeRoute?.label ?? (quoting ? 'Quoting…' : 'Jupiter')) : (quote?.route || 'Jupiter')}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Network</Text>
            <Text style={styles.summaryValue}>
              {bridge === 'eth-to-sol' ? 'Ethereum → Solana' : bridge === 'sol-to-eth' ? 'Solana → Ethereum' : 'Solana'}
            </Text>
          </View>
          <Text style={styles.mutedLabel}>Slippage</Text>
          <View style={styles.chipRow}>
            {SLIPPAGE.map((choice) => (
              <TouchableOpacity
                key={choice.bps}
                style={[styles.chip, slippage === choice.bps && styles.chipActive]}
                onPress={() => setSlippage(choice.bps)}
              >
                <Text style={[styles.chipText, slippage === choice.bps && styles.chipTextActive]}>
                  {choice.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {error ? <Text style={styles.warn}>{error}</Text> : null}
        {txUrl ? (
          <TouchableOpacity onPress={() => { void Linking.openURL(txUrl); }}>
            <Text style={[styles.hint, { color: '#93c5fd' }]}>View transaction</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.cta, (!canReview || flow.busy || quoting) && styles.ctaDisabled]}
          disabled={!canReview || flow.busy || quoting}
          onPress={() => setConfirmOpen(true)}
        >
          <Text style={styles.ctaText}>{bridge ? 'Review bridge' : 'Review swap'}</Text>
        </TouchableOpacity>
        </>
        )}
      </View>
      <SpendConfirm
        open={confirmOpen && !tunnel && (bridge ? bridgeRoute != null : quote != null || flow.busy || flow.outcome != null)}
        title={bridge ? `Bridge ${shownPay} to ${shownReceive}` : `Swap ${payToken.symbol} for ${receiveToken.symbol}`}
        confirmLabel={bridge ? 'Bridge' : 'Swap'}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        rows={bridge ? [
          { label: 'You pay', value: `${amount.trim()} ${shownPay}` },
          { label: 'You receive', value: `${received} ${shownReceive}` },
          { label: 'Minimum', value: minimum },
          { label: 'Route', value: bridgeRoute?.label ?? 'Jupiter' },
          { label: 'Arrives at', value: bridge === 'eth-to-sol' ? address : (ethAddress || '') },
        ] : [
          { label: 'You pay', value: `${amount.trim()} ${payToken.symbol}` },
          { label: 'You receive', value: quote ? `about ${quote.outText} ${receiveToken.symbol}` : '…' },
          { label: 'Minimum', value: minimum },
          { label: 'Slippage', value: slippageLabel },
          { label: 'Route', value: quote?.route || 'Jupiter' },
        ]}
        onCancel={() => {
          flow.close(() => {
            setAmount('');
            setQuote(null);
            setBridgeRoutes([]);
            setBridgeProvider(null);
          });
          setConfirmOpen(false);
        }}
        onConfirm={() => { void (bridge ? submitBridge() : submit()); }}
      />
    </DefiModalShell>
  );
};

export default SolSwapModal;
