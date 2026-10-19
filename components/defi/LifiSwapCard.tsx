import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import TokenIcon from '../TokenIcon';
import { defiColors } from './defiStyles';
import { swapPanelStyles as styles } from './swapPanelStyles';
import { btcTxUrl, fetchBtcBalance, maxBtcPayment, parseBtc } from '../../utils/networks/btc';
import { explainChainError } from '../../utils/networks/http';
import {
  executeLifiSwap,
  formatLifi,
  formatLifiWait,
  lifiOutcome,
  lifiStep,
  listLifiRoutes,
  markLifiMove,
  quoteLifiSwap,
  readLifiMoves,
  readLifiStatus,
  saveLifiMove,
  type LifiAsset,
  type LifiMove,
  type LifiRoute,
  type LifiStatus,
} from '../../utils/networks/lifiSwap';
import { fetchSolBalance, maxSolPayment, parseSol, solTxUrl } from '../../utils/networks/solana';
import { toast } from '../../utils/toast';

interface Props {
  visible: boolean;
  solAddress: string;
  btcAddress: string;
  onSent: () => void;
  /** Draw the fields inside the Solana swap panel instead of a second card. */
  bare?: boolean;
  /** Keep tracking open moves while the Tunnel pill is not selected. */
  showForm?: boolean;
}

function shortAddr(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

const LifiSwapCard: React.FC<Props> = ({
  visible,
  solAddress,
  btcAddress,
  onSent,
  bare = false,
  showForm = true,
}) => {
  const [fromSol, setFromSol] = useState(true);
  const [amount, setAmount] = useState('');
  const [solLamports, setSolLamports] = useState<bigint | null>(null);
  const [btcSats, setBtcSats] = useState<bigint | null>(null);
  const [routes, setRoutes] = useState<LifiRoute[]>([]);
  const [tool, setTool] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const busy = flow.busy;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [moves, setMoves] = useState<LifiMove[]>([]);
  const [stages, setStages] = useState<Record<string, LifiStatus | null>>({});
  const swapping = useRef(false);
  const told = useRef(new Set<string>());

  const pay: LifiAsset = fromSol ? 'SOL' : 'BTC';
  const receive: LifiAsset = fromSol ? 'BTC' : 'SOL';
  const fromAddress = fromSol ? solAddress : btcAddress;
  const destination = fromSol ? btcAddress : solAddress;
  const balance = fromSol ? solLamports : btcSats;

  const loadBalances = async () => {
    const [sol, btc] = await Promise.all([
      fetchSolBalance(solAddress).catch(() => null),
      fetchBtcBalance(btcAddress).catch(() => null),
    ]);
    setSolLamports(sol);
    setBtcSats(btc);
  };

  useEffect(() => {
    if (!visible) return;
    setAmount('');
    setRoutes([]);
    setTool('');
    setError(null);
    setConfirmOpen(false);
    let cancel = false;
    const run = () => {
      void loadBalances();
      void readLifiMoves(solAddress, btcAddress).then((rows) => {
        if (!cancel) setMoves(rows);
      });
    };
    run();
    const poll = setInterval(run, 20_000);
    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [visible, solAddress, btcAddress]);

  const openMoves = moves.filter((row) => row.status === 'submitted');
  useEffect(() => {
    if (!visible || openMoves.length === 0) return;
    let cancel = false;
    const look = async () => {
      const next: Record<string, LifiStatus | null> = {};
      for (const move of openMoves) {
        const status = await readLifiStatus(move);
        next[move.id] = status;
        const outcome = lifiOutcome(status);
        if (outcome !== 'pending' && !told.current.has(move.id)) {
          told.current.add(move.id);
          await markLifiMove(move.id, outcome);
          if (!cancel) {
            toast.success(
              outcome === 'done' ? 'Swap paid out' : outcome === 'refunded' ? 'Swap refunded' : 'Swap failed',
              outcome === 'done'
                ? `${formatLifi(BigInt(move.expectedOut), move.direction === 'sol-to-btc' ? 'BTC' : 'SOL')} is on its way to this wallet.`
                : outcome === 'refunded'
                  ? 'The deposit was sent back.'
                  : 'LI.FI marked this swap failed.',
            );
          }
        }
      }
      if (cancel) return;
      setStages(next);
      if (Object.values(next).some((status) => lifiOutcome(status) !== 'pending')) {
        setMoves(await readLifiMoves(solAddress, btcAddress));
      }
    };
    void look();
    const poll = setInterval(() => { void look(); }, 20_000);
    return () => {
      cancel = true;
      clearInterval(poll);
    };
  }, [visible, openMoves.map((row) => row.id).join('|'), solAddress, btcAddress]);

  useEffect(() => {
    if (!showForm) setConfirmOpen(false);
  }, [showForm]);

  useEffect(() => {
    if (!visible || !showForm) {
      setQuoting(false);
      return;
    }
    if (!amount.trim()) {
      setRoutes([]);
      setQuoting(false);
      return;
    }
    let cancel = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (async () => {
        let raw: bigint;
        try {
          raw = pay === 'SOL' ? parseSol(amount) : parseBtc(amount);
        } catch {
          if (!cancel) setQuoting(false);
          return;
        }
        const reserve = pay === 'SOL' ? 890_880n + 50_000n : 3_000n;
        if (balance != null && raw + reserve > balance) {
          if (!cancel) {
            setQuoting(false);
            setRoutes([]);
            setError(pay === 'SOL'
              ? 'Leave some SOL for the network fee and the account.'
              : 'Leave Bitcoin for the miner fee. The swap amount is on top of it.');
          }
          return;
        }
        try {
          const next = await listLifiRoutes({
            from: pay,
            to: receive,
            amountIn: raw,
            fromAddress,
            toAddress: destination,
          });
          if (!cancel) {
            setRoutes(next);
            setTool((current) => (next.some((route) => route.tool === current) ? current : next[0].tool));
            setError(null);
          }
        } catch (err: unknown) {
          if (!cancel) {
            setRoutes([]);
            setError(explainChainError(err));
          }
        } finally {
          if (!cancel) setQuoting(false);
        }
      })();
    }, 1100);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [amount, pay, receive, fromAddress, destination, visible, balance, showForm]);

  const flip = () => {
    setFromSol((value) => !value);
    setAmount('');
    setRoutes([]);
    setTool('');
    setError(null);
    setConfirmOpen(false);
  };

  const fillMax = () => {
    const job = pay === 'SOL'
      ? maxSolPayment(solAddress, 50_000n)
      : maxBtcPayment({ memoBytes: 80 }).then((max) => (max > 2_000n ? max - 2_000n : 0n));
    void job.then((max) => {
      if (max <= 0n) {
        setError(pay === 'SOL' ? 'Keep a little SOL for the fee and the account.' : 'No Bitcoin to swap.');
        return;
      }
      setAmount(formatLifi(max, pay));
      setError(null);
    }).catch((err: unknown) => setError(explainChainError(err)));
  };

  const selected = routes.find((route) => route.tool === tool) ?? null;

  const submit = async () => {
    if (!selected || swapping.current) return;
    swapping.current = true;
    const shown = selected;
    flow.begin(`Swapping ${amount.trim()} ${pay} for ${receive} through ${shown.toolLabel}…`);
    try {
      flow.setStep('Checking the quote again…');
      const fresh = await quoteLifiSwap({
        from: pay,
        to: receive,
        amountIn: pay === 'SOL' ? parseSol(amount) : parseBtc(amount),
        fromAddress,
        toAddress: destination,
        tool: shown.tool,
      });
      if (fresh.tool !== shown.tool || fresh.minOut < shown.minOut) {
        setRoutes((rows) => rows.map((route) => (
          route.tool === fresh.tool
            ? { ...route, expectedOut: fresh.expectedOut, minOut: fresh.minOut, seconds: fresh.seconds, toolLabel: fresh.toolLabel }
            : route
        )));
        setTool(fresh.tool);
        throw new Error('The quote moved. Review the new amount.');
      }
      flow.setStep(`Sending through ${fresh.toolLabel}…`);
      const hash = await executeLifiSwap(fresh, fromAddress);
      await saveLifiMove({
        id: hash,
        direction: fresh.from === 'SOL' ? 'sol-to-btc' : 'btc-to-sol',
        createdAt: Date.now(),
        amountIn: fresh.amountIn.toString(),
        expectedOut: fresh.expectedOut.toString(),
        from: fromAddress,
        to: destination,
        txHash: hash,
        tool: fresh.tool,
        toolLabel: fresh.toolLabel,
        fromChain: fresh.from === 'SOL' ? 'sol' : 'btc',
        toChain: fresh.to === 'SOL' ? 'sol' : 'btc',
        status: 'submitted',
      });
      setMoves(await readLifiMoves(solAddress, btcAddress));
      flow.finish(true, 'Swap sent', `${fresh.toolLabel} pays the other chain after it sees this transaction.`);
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

  const availableText = balance == null ? '…' : `${formatLifi(balance, pay)} ${pay}`;
  const received = selected ? formatLifi(selected.expectedOut, receive) : '0';
  const minimum = selected ? `${formatLifi(selected.minOut, receive)} ${receive}` : '—';
  const blocked = !selected || quoting || busy;

  if (!visible) return null;

  const moveList = openMoves.length > 0 ? (
    <View style={{ gap: 8, marginBottom: bare ? 0 : 10 }}>
      {openMoves.map((move) => {
        const view = lifiStep(stages[move.id] ?? null, move.toolLabel);
        const inboundSol = move.direction === 'sol-to-btc';
        return (
          <View key={move.id} style={styles.summary}>
            <Text style={styles.cardTitle}>{inboundSol ? 'SOL → BTC' : 'BTC → SOL'}</Text>
            <Text style={styles.hint}>{view.step}</Text>
            <Text style={styles.cardSub}>{view.eta}</Text>
            <TouchableOpacity onPress={() => { void Linking.openURL(inboundSol ? solTxUrl(move.txHash) : btcTxUrl(move.txHash)); }}>
              <Text style={[styles.hint, { color: '#93c5fd' }]}>Transaction</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  ) : null;

  const form = showForm ? (
    <>
        {routes.length > 0 ? (
          <>
            <Text style={styles.mutedLabel}>Route</Text>
            <View style={styles.chipRow}>
              {routes.map((route) => {
                const active = route.tool === selected?.tool;
                return (
                  <TouchableOpacity
                    key={route.tool}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => { setTool(route.tool); setConfirmOpen(false); }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{route.toolLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.mutedLabel}>You pay</Text>
            <TouchableOpacity onPress={fillMax} disabled={balance === 0n}>
              <Text style={styles.balanceHint}>Available {availableText}</Text>
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
            <TouchableOpacity style={styles.chip} onPress={fillMax} disabled={balance === 0n}>
              <Text style={styles.chipText}>MAX</Text>
            </TouchableOpacity>
            <View style={styles.tokenPill}>
              <TokenIcon symbol={pay} size={22} />
              <Text style={styles.tokenPillText}>{pay}</Text>
            </View>
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
            <Text style={styles.balanceHint}>Estimate · 1.5% price limit</Text>
          </View>
          <View style={styles.amountRow}>
            <Text style={[styles.amountInput, { paddingVertical: 8 }]}>{quoting ? '…' : received}</Text>
            <View style={styles.tokenPill}>
              <TokenIcon symbol={receive} size={22} />
              <Text style={styles.tokenPillText}>{receive}</Text>
            </View>
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Minimum</Text>
            <Text style={styles.summaryValue}>{minimum}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Time</Text>
            <Text style={styles.summaryValue}>{selected ? formatLifiWait(selected.seconds) : '—'}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Arrives at</Text>
            <Text style={styles.summaryValue}>{shortAddr(destination)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.mutedLabel}>Network fee</Text>
            <Text style={styles.summaryValue}>{fromSol ? 'Included' : 'Bitcoin, on top'}</Text>
          </View>
        </View>

        {error ? <Text style={styles.warn}>{error}</Text> : null}
        <Text style={styles.hint}>
          A market swap. Pick a route. The quote is fetched again at confirm, and it is dropped if that route’s minimum fell.
        </Text>

        <TouchableOpacity
          style={[styles.cta, blocked && styles.ctaDisabled]}
          disabled={blocked}
          onPress={() => setConfirmOpen(true)}
        >
          <Text style={styles.ctaText}>Review swap</Text>
        </TouchableOpacity>
    </>
  ) : null;

  const confirm = (
    <SpendConfirm
      open={confirmOpen && (selected != null || flow.busy || flow.outcome != null) && showForm}
      title={`Swap ${pay} for ${receive}`}
      confirmLabel="Swap"
      busy={flow.busy}
      step={flow.step}
      outcome={flow.outcome}
      rows={[
        { label: 'You pay', value: `${amount.trim()} ${pay}` },
        { label: 'You receive', value: selected ? `about ${formatLifi(selected.expectedOut, receive)} ${receive}` : '…' },
        { label: 'Minimum', value: minimum },
        { label: 'Time', value: selected ? formatLifiWait(selected.seconds) : '…' },
        { label: 'To', value: destination },
        { label: 'Route', value: selected ? selected.toolLabel : '…' },
      ]}
      onCancel={() => {
        flow.close(() => {
          setAmount('');
          setRoutes([]);
          setTool('');
        });
        setConfirmOpen(false);
      }}
      onConfirm={() => { void submit(); }}
    />
  );

  if (bare) {
    return (
      <>
        {moveList}
        {form}
        {confirm}
      </>
    );
  }

  return (
    <View>
      {moveList}
      <View style={styles.swapCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>SOL ↔ BTC</Text>
            <Text style={styles.cardSub}>Native {pay} for native {receive}</Text>
          </View>
        </View>
        {form}
      </View>
      {confirm}
    </View>
  );
};

export default LifiSwapCard;
