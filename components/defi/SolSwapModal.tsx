import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import DefiModalShell from './DefiModalShell';
import SpendConfirm from '../SpendConfirm';
import { defiStyles } from './defiStyles';
import { explainChainError } from '../../utils/networks/http';
import { fetchSolBalance, formatSol, solTxUrl } from '../../utils/networks/solana';
import {
  STABLES,
  executeSwap,
  fetchSplBalance,
  formatSwapAmount,
  maxSwapAmount,
  parseSwapAmount,
  quoteSwap,
  type StableSymbol,
  type SwapQuote,
  type SwapSide,
} from '../../utils/networks/solswap';
import { toast } from '../../utils/toast';

interface Props {
  visible: boolean;
  address: string;
  onClose: () => void;
  onSent: () => void;
}

const PAY_CHOICES: SwapSide[] = ['SOL', 'USDC', 'USDT'];

const SolSwapModal: React.FC<Props> = ({ visible, address, onClose, onSent }) => {
  const [pay, setPay] = useState<SwapSide>('SOL');
  const [stable, setStable] = useState<StableSymbol>('USDC');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(50);
  const [balances, setBalances] = useState<{ SOL: string; USDC: string; USDT: string } | null>(null);
  const [rawBalances, setRawBalances] = useState<{ SOL: bigint; USDC: bigint; USDT: bigint } | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const receive: SwapSide = pay === 'SOL' ? stable : 'SOL';

  const loadBalances = async () => {
    const [sol, usdc, usdt] = await Promise.all([
      fetchSolBalance(address),
      fetchSplBalance(address, STABLES.USDC.mint),
      fetchSplBalance(address, STABLES.USDT.mint),
    ]);
    setRawBalances({ SOL: sol, USDC: usdc, USDT: usdt });
    setBalances({
      SOL: formatSol(sol),
      USDC: formatSwapAmount(usdc, 'USDC'),
      USDT: formatSwapAmount(usdt, 'USDT'),
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
    return () => { cancel = true; };
  }, [visible, address]);

  useEffect(() => {
    if (!visible) return;
    setQuote(null);
    let cancel = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!amount.trim()) return;
        let raw: bigint;
        try {
          raw = parseSwapAmount(amount, pay);
        } catch {
          return;
        }
        try {
          if (rawBalances && raw > rawBalances[pay]) {
            if (!cancel) setError(`Only ${balances?.[pay] ?? '0'} ${pay} is available.`);
            return;
          }
          const next = await quoteSwap(pay, receive, raw, slippage);
          if (!cancel) {
            setError(null);
            setQuote(next);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setQuote(null);
            setError(explainChainError(err));
          }
        }
      })();
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [amount, pay, receive, slippage, visible, rawBalances, balances]);

  const submit = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await executeSwap(address, quote.raw);
      setTxUrl(solTxUrl(tx.signature));
      setConfirmOpen(false);
      setAmount('');
      setQuote(null);
      toast.success('Swapped', `${pay} to ${receive} is on Solana.`);
      await loadBalances();
      onSent();
    } catch (err: unknown) {
      setConfirmOpen(false);
      setError(explainChainError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title="Swap on Solana"
      subtitle="Jupiter. SOL against USDC or USDT. The route is built when you review."
    >
      <Text style={defiStyles.label}>You pay</Text>
      <View style={defiStyles.ethChoiceRow}>
        {PAY_CHOICES.map((choice) => (
          <TouchableOpacity
            key={choice}
            style={[defiStyles.compactBtn, pay === choice && defiStyles.compactBtnActive, { flex: 1 }]}
            onPress={() => { setPay(choice); setAmount(''); setQuote(null); setError(null); }}
          >
            <Text style={[defiStyles.compactBtnText, pay === choice && defiStyles.compactBtnTextActive]}>
              {choice}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {pay === 'SOL' ? (
        <View style={defiStyles.ethChoiceRow}>
          {(['USDC', 'USDT'] as const).map((choice) => (
            <TouchableOpacity
              key={choice}
              style={[defiStyles.compactBtn, stable === choice && defiStyles.compactBtnActive, { flex: 1 }]}
              onPress={() => setStable(choice)}
            >
              <Text style={[defiStyles.compactBtnText, stable === choice && defiStyles.compactBtnTextActive]}>
                Receive {choice}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <Text style={defiStyles.ethHoldingsHint}>You receive SOL.</Text>
      )}
      <Text style={defiStyles.label}>
        Amount{balances ? ` · ${balances[pay]} ${pay}` : ''}
      </Text>
      <View style={defiStyles.ethAmountRow}>
        <TextInput
          style={[defiStyles.input, { flex: 1, marginBottom: 0 }]}
          value={amount}
          onChangeText={(text) => { setAmount(text); setError(null); }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#71717a"
        />
        <TouchableOpacity
          style={[defiStyles.compactBtn, { marginBottom: 0 }]}
          onPress={() => {
            if (!rawBalances) return;
            const max = maxSwapAmount(rawBalances[pay], pay);
            if (max <= 0n) {
              setError(pay === 'SOL' ? 'Keep a little SOL for fees and the token account.' : `No ${pay} to swap.`);
              return;
            }
            setAmount(formatSwapAmount(max, pay));
            setError(null);
          }}
        >
          <Text style={defiStyles.compactBtnText}>Max</Text>
        </TouchableOpacity>
      </View>
      {pay === 'SOL' ? (
        <Text style={defiStyles.ethHoldingsHint}>Max leaves 0.01 SOL for fees and a token account.</Text>
      ) : null}
      <View style={defiStyles.ethChoiceRow}>
        {[50, 100].map((bps) => (
          <TouchableOpacity
            key={bps}
            style={[defiStyles.compactBtn, slippage === bps && defiStyles.compactBtnActive, { flex: 1 }]}
            onPress={() => setSlippage(bps)}
          >
            <Text style={[defiStyles.compactBtnText, slippage === bps && defiStyles.compactBtnTextActive]}>
              {bps / 100}% slippage
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={defiStyles.ethHoldingsHint}>
        {quote
          ? `You receive about ${quote.outText} ${receive}. Minimum ${quote.minimumText}. Impact ${quote.impactPct}%. ${quote.route}.`
          : 'Enter an amount for a Jupiter quote.'}
      </Text>
      {balances ? (
        <Text style={defiStyles.ethHoldingsHint}>
          {balances.USDC} USDC · {balances.USDT} USDT
        </Text>
      ) : null}
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
      {txUrl ? (
        <TouchableOpacity onPress={() => { void Linking.openURL(txUrl); }}>
          <Text style={defiStyles.ethTxLink}>View transaction</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[defiStyles.heroSendBtn, { marginTop: 12 }]}
        onPress={() => {
          if (!quote) {
            setError('Wait for the quote.');
            return;
          }
          setConfirmOpen(true);
        }}
        disabled={busy}
      >
        <Text style={defiStyles.heroSendBtnText}>Review swap</Text>
      </TouchableOpacity>
      <SpendConfirm
        open={confirmOpen}
        title={`Swap ${pay} for ${receive}`}
        busy={busy}
        rows={[
          { label: 'You pay', value: `${amount.trim()} ${pay}` },
          { label: 'You receive', value: quote ? `about ${quote.outText} ${receive}` : '…' },
          { label: 'Minimum', value: quote ? `${quote.minimumText} ${receive}` : '…' },
          { label: 'Route', value: quote?.route || 'Jupiter' },
        ]}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={() => { void submit(); }}
      />
    </DefiModalShell>
  );
};

export default SolSwapModal;
