import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import FormattedNumber from '../FormattedNumber';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { explainChainError } from '../../utils/networks/http';
import { ethTxUrl } from '../../utils/networks/ethBridge';
import { solTxUrl } from '../../utils/networks/solana';
import { formatRawAmountFloor, rawToDecimal } from '../../utils/ethHoldings';
import { readOneBalance } from '../../utils/tokenBalances';
import { isLedgerSession } from '../../utils/sessionVault';
import AssetMenu from './AssetMenu';
import type { WalletToken } from '../../utils/walletTokens';
import {
  BRIDGE_ETH,
  BRIDGE_SOL,
  bridgeAssets,
  executeJupBridge,
  formatBridgeAmount,
  parseBridgeAmount,
  quoteJupBridge,
  type JupBridgeAsset,
  type JupBridgeDirection,
  type JupBridgeProvider,
  type JupBridgeRoute,
} from '../../utils/networks/jupBridge';

interface Props {
  ethAddress: string;
  solAddress: string;
  initialDirection: JupBridgeDirection;
  onSent: (direction: JupBridgeDirection) => void;
}

const SLIPPAGE = [
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
] as const;
const ETH_RESERVE = 3_000_000_000_000_000n;
const SOL_RESERVE = 20_000_000n;

function waitText(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} sec`;
  return `about ${Math.max(1, Math.round(seconds / 60))} min`;
}

function feeText(route: JupBridgeRoute | null): string {
  if (!route?.appFeeBps) return '—';
  return `${route.appFeeBps / 100}%`;
}

function asToken(asset: JupBridgeAsset): WalletToken {
  return {
    id: `${asset.chain}:${asset.address}`,
    network: asset.chain,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    address: asset.address,
    native: asset.native,
  };
}

function fromToken(token: WalletToken, chain: 'ethereum' | 'solana'): JupBridgeAsset | null {
  return bridgeAssets(chain).find((asset) => asset.symbol === token.symbol) ?? null;
}

/** ETH, USDC, and USDT between Ethereum and Solana through Relay and Mayan. */
const JupBridgeForm: React.FC<Props> = ({ ethAddress, solAddress, initialDirection, onSent }) => {
  const [pay, setPay] = useState<JupBridgeAsset>(initialDirection === 'eth-to-sol' ? BRIDGE_ETH : BRIDGE_SOL);
  const [receive, setReceive] = useState<JupBridgeAsset>(initialDirection === 'eth-to-sol' ? BRIDGE_SOL : BRIDGE_ETH);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [routes, setRoutes] = useState<JupBridgeRoute[]>([]);
  const [provider, setProvider] = useState<JupBridgeProvider | null>(null);
  const [held, setHeld] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const flow = useSpendFlow();
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const sending = useRef(false);

  const selected = routes.find((route) => route.provider === provider) ?? null;
  const direction: JupBridgeDirection = pay.chain === 'ethereum' ? 'eth-to-sol' : 'sol-to-eth';

  useEffect(() => {
    let cancel = false;
    setHeld(null);
    void readOneBalance(pay.chain, pay.chain === 'ethereum' ? ethAddress : solAddress, pay)
      .then((value) => { if (!cancel) setHeld(value); })
      .catch(() => { if (!cancel) setHeld(null); });
    return () => { cancel = true; };
  }, [pay, ethAddress, solAddress]);

  useEffect(() => {
    if (!amount.trim()) {
      setRoutes([]);
      setProvider(null);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const raw = parseBridgeAmount(amount, pay);
          const next = await quoteJupBridge({
            pay,
            receive,
            amountIn: raw,
            ethAddress,
            solAddress,
            slippageBps,
          });
          if (cancel) return;
          setRoutes(next);
          setProvider((current) => (
            current && next.some((route) => route.provider === current) ? current : next[0].provider
          ));
          if (held != null && raw > held) {
            setError(`This route needs ${amount.trim()} ${pay.symbol}. This wallet has ${formatBridgeAmount(held, pay.decimals)}.`);
          } else {
            setError(null);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setRoutes([]);
            setProvider(null);
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
  }, [amount, pay, receive, ethAddress, solAddress, slippageBps, held]);

  const availableText = held == null ? null : rawToDecimal(held, pay.decimals);

  const fillMax = () => {
    if (held == null) return;
    const reserve = pay.symbol === 'ETH' && pay.native ? ETH_RESERVE : pay.symbol === 'SOL' && pay.native ? SOL_RESERVE : 0n;
    const max = held > reserve ? held - reserve : 0n;
    if (max <= 0n) {
      setError(pay.native
        ? `Not enough ${pay.symbol} for the bridge and the network fee.`
        : `This wallet has no ${pay.symbol}.`);
      return;
    }
    setAmount(formatRawAmountFloor(max, pay.decimals, 6));
    setError(null);
  };

  const flip = () => {
    setPay(receive);
    setReceive(pay);
    setAmount('');
    setRoutes([]);
    setProvider(null);
    setError(null);
    setConfirmOpen(false);
  };

  const choose = (side: 'pay' | 'receive', token: WalletToken) => {
    const chain = side === 'pay' ? pay.chain : receive.chain;
    const asset = fromToken(token, chain);
    if (!asset) return;
    const other = side === 'pay' ? receive : pay;
    if (asset.symbol === other.symbol && asset.chain === other.chain) return;
    setAmount('');
    setRoutes([]);
    setProvider(null);
    setError(null);
    setConfirmOpen(false);
    if (side === 'pay') setPay(asset);
    else setReceive(asset);
  };

  const submit = async () => {
    if (!selected || sending.current) return;
    sending.current = true;
    const current = selected;
    flow.begin(`Bridging ${amount.trim()} ${current.pay.symbol} to ${current.receive.symbol} with ${current.label}…`);
    try {
      const hash = await executeJupBridge(current, ethAddress, solAddress);
      setTxUrl(current.direction === 'eth-to-sol' ? ethTxUrl(hash) : solTxUrl(hash));
      flow.finish(true, 'Bridge sent', `${current.label} has the transfer. The other chain pays this wallet.`);
      onSent(current.direction);
      const next = await readOneBalance(pay.chain, pay.chain === 'ethereum' ? ethAddress : solAddress, pay).catch(() => null);
      if (next != null) setHeld(next);
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      flow.finish(false, 'Bridge failed', message);
    } finally {
      sending.current = false;
    }
  };

  const received = selected ? formatBridgeAmount(selected.expectedOut, receive.decimals) : '0';
  const minimum = selected ? `${formatBridgeAmount(selected.minOut, receive.decimals)} ${receive.symbol}` : '—';
  const canReview = Boolean(selected) && !error && !quoting && !flow.busy;
  return (
    <>
      {routes.length > 0 ? (
        <View style={styles.chipRow}>
          {routes.map((route) => {
            const on = route.provider === selected?.provider;
            return (
              <TouchableOpacity
                key={route.provider}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => { setProvider(route.provider); setConfirmOpen(false); }}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{route.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      <Text style={styles.hint}>
        Jupiter bridge · Relay and Mayan, the same routes as edge.jup.ag/bridge. ETH, USDC, and USDT move between Ethereum and Solana. Ethereum needs about $10. The amount arrives in this wallet.
      </Text>
      {isLedgerSession() && direction === 'sol-to-eth' ? (
        <Text style={styles.hint}>The Solana app signs this. Turn on Blind signing in that app first.</Text>
      ) : null}
      {isLedgerSession() && direction === 'eth-to-sol' ? (
        <Text style={styles.hint}>The Ethereum app signs this. Turn on Blind signing in that app first.</Text>
      ) : null}

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <Text style={styles.mutedLabel}>You pay</Text>
          <TouchableOpacity onPress={fillMax} disabled={held === 0n}>
            <Text style={styles.balanceHint}>
              Available{' '}
              {availableText == null ? (
                <Text style={{ color: defiColors.textSecondary }}>…</Text>
              ) : (
                <FormattedNumber value={availableText} variant="balance" style={styles.balanceHint} />
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
          <TouchableOpacity style={styles.chip} onPress={fillMax} disabled={held === 0n}>
            <Text style={styles.chipText}>MAX</Text>
          </TouchableOpacity>
          <AssetMenu
            label={pay.symbol}
            tokens={bridgeAssets(pay.chain).map(asToken)}
            selectedId={asToken(pay).id}
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
            tokens={bridgeAssets(receive.chain).map(asToken)}
            selectedId={asToken(receive).id}
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
          <Text style={styles.mutedLabel}>Route</Text>
          <Text style={styles.summaryValue}>{selected?.label ?? (quoting ? 'Quoting…' : 'Relay or Mayan')}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.mutedLabel}>Network</Text>
          <Text style={styles.summaryValue}>{direction === 'eth-to-sol' ? 'Ethereum → Solana' : 'Solana → Ethereum'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.mutedLabel}>Route fee</Text>
          <Text style={styles.summaryValue}>{feeText(selected)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.mutedLabel}>Time</Text>
          <Text style={styles.summaryValue}>{waitText(selected?.etaSeconds ?? null)}</Text>
        </View>
        <Text style={styles.mutedLabel}>Slippage</Text>
        <View style={styles.chipRow}>
          {SLIPPAGE.map((choice) => (
            <TouchableOpacity
              key={choice.bps}
              style={[styles.chip, slippageBps === choice.bps && styles.chipActive]}
              onPress={() => setSlippageBps(choice.bps)}
            >
              <Text style={[styles.chipText, slippageBps === choice.bps && styles.chipTextActive]}>{choice.label}</Text>
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
        style={[styles.cta, !canReview && styles.ctaDisabled]}
        disabled={!canReview}
        onPress={() => setConfirmOpen(true)}
      >
        <Text style={styles.ctaText}>Review bridge</Text>
      </TouchableOpacity>

      <SpendConfirm
        open={confirmOpen && (selected != null || flow.busy || flow.outcome != null)}
        title={`Bridge ${pay.symbol} to ${receive.symbol}`}
        confirmLabel="Bridge"
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        rows={[
          { label: 'You pay', value: `${amount.trim() || '…'} ${pay.symbol}` },
          { label: 'You receive', value: `${received} ${receive.symbol}` },
          { label: 'Minimum', value: minimum },
          { label: 'Route', value: selected?.label ?? '…' },
          { label: 'Arrives at', value: direction === 'eth-to-sol' ? solAddress : ethAddress },
        ]}
        onCancel={() => {
          flow.close(() => {
            setAmount('');
            setRoutes([]);
            setProvider(null);
          });
          setConfirmOpen(false);
        }}
        onConfirm={() => { void submit(); }}
      />
    </>
  );
};

export default JupBridgeForm;
