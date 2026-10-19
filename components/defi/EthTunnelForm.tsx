import React, { useEffect, useState } from 'react';
import { Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { defiStyles } from './defiStyles';
import { AvailRow, QuoteLine, SpinCoin, formatRemain, formatWhen, styles } from './tunnelUi';
import { explainChainError } from '../../utils/networks/http';
import { fetchHemiBalance, formatHemi, hemiTxUrl } from '../../utils/networks/hemi';
import {
  ETH_DERIVE_SECONDS,
  depositEth,
  destinationIsContract,
  estimateBridgeFee,
  ethTxUrl,
  withdrawEth,
  finalizeWithdrawal,
  markEthMove,
  maxBridgeAmount,
  proveWithdrawal,
  readEthBridge,
  readEthInclusion,
  readEthMoves,
  readL1Eth,
  readWithdrawalStage,
  requireEthAddress,
  saveEthMove,
  storedWithdrawal,
  withdrawalFields,
  type EthBridgeInfo,
  type EthInclusion,
  type EthMove,
  type WithdrawalStage,
} from '../../utils/networks/ethBridge';
import { toast } from '../../utils/toast';

function readWei(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, '0') || '0');
}

function waitLabel(seconds: number): string {
  const hours = Math.max(1, Math.round(seconds / 3600));
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

function ethOpen(move: EthMove, stage: WithdrawalStage | 'error' | undefined): boolean {
  if (move.direction === 'to-hemi') return move.status !== 'credited';
  if (move.status === 'finalized') return false;
  if (stage && stage !== 'error' && stage.kind === 'finalized') return false;
  return true;
}

type StepView = { spinning: boolean; step: string; message: string; eta: string; done: boolean };

function depositView(move: EthMove, inclusion: EthInclusion | 'error' | undefined, now: number): StepView {
  if (move.status === 'credited') {
    return {
      spinning: false,
      done: true,
      step: 'Done · ETH is on Hemi',
      message: 'The Hemi balance increased by this deposit.',
      eta: formatWhen(move.createdAt),
    };
  }
  if (inclusion === 'failed') {
    return {
      spinning: false,
      done: false,
      step: 'Deposit failed',
      message: 'Ethereum included the transaction and it reverted. Nothing was bridged.',
      eta: 'This move will not finish',
    };
  }
  if (inclusion == null || inclusion === 'error' || inclusion === 'pending') {
    return {
      spinning: true,
      done: false,
      step: 'Step 1 of 2 · Waiting for Ethereum',
      message: inclusion === 'error'
        ? 'Could not read the Ethereum receipt. Still tracking this deposit.'
        : 'The deposit is in the Ethereum mempool.',
      eta: 'The next Ethereum block is usually about 12 seconds',
    };
  }
  const readyAt = inclusion.timestamp * 1000 + ETH_DERIVE_SECONDS * 1000;
  return {
    spinning: true,
    done: false,
    step: 'Step 2 of 2 · Hemi derivation',
    message: 'Ethereum included the deposit. Hemi credits the same amount after it derives that block.',
    eta: now >= readyAt
      ? 'The usual window has passed. This closes when the Hemi ETH balance increases.'
      : formatRemain(readyAt, now),
  };
}

function withdrawView(move: EthMove, stage: WithdrawalStage | 'error' | undefined, now: number): StepView {
  if (move.status === 'finalized' || (stage && stage !== 'error' && stage.kind === 'finalized')) {
    return {
      spinning: false,
      done: true,
      step: 'Done · ETH is on Ethereum',
      message: 'Finalize succeeded. The portal paid the withdrawal.',
      eta: formatWhen(move.createdAt),
    };
  }
  if (stage == null) {
    return {
      spinning: true,
      done: false,
      step: 'Checking the portal',
      message: 'Reading where this withdrawal is on Ethereum.',
      eta: 'Checking…',
    };
  }
  if (stage === 'error') {
    return {
      spinning: true,
      done: false,
      step: 'Portal status unavailable',
      message: 'The tracker will try again. The withdrawal is still saved on this device.',
      eta: 'Retrying about every 20 seconds',
    };
  }
  if (stage.kind === 'waiting-output') {
    const eta = stage.aboutSeconds == null
      ? 'Time until the next output is unavailable'
      : stage.aboutSeconds <= 0
        ? 'Any moment'
        : formatRemain(now + stage.aboutSeconds * 1000, now);
    return {
      spinning: true,
      done: false,
      step: 'Step 1 of 4 · Waiting for a Hemi output',
      message: move.l2Block == null
        ? 'A published Hemi output has to include this withdrawal.'
        : `A published Hemi output has to include block ${move.l2Block.toLocaleString()}. Outputs are every 120 Hemi blocks, about 24 minutes.`,
      eta,
    };
  }
  if (stage.kind === 'ready-to-prove') {
    return {
      spinning: true,
      done: false,
      step: 'Step 2 of 4 · Prove on Ethereum',
      message: 'An output includes this withdrawal. Proving is your Ethereum transaction.',
      eta: 'Waiting on you',
    };
  }
  if (stage.kind === 'waiting-finality') {
    return {
      spinning: true,
      done: false,
      step: 'Step 3 of 4 · Finality wait',
      message: `Proven. Finalize is allowed after ${formatWhen(stage.readyAt * 1000)}. Both the proof and the output have to finish the 24 hour period.`,
      eta: formatRemain(stage.readyAt * 1000, now),
    };
  }
  return {
    spinning: true,
    done: false,
    step: 'Step 4 of 4 · Finalize on Ethereum',
    message: 'The wait is over. Finalizing pays the ETH out of the portal.',
    eta: 'Waiting on you',
  };
}

export function EthMoveList({
  visible,
  address,
  tick,
}: {
  visible: boolean;
  address: string;
  tick: number;
}) {
  const [moves, setMoves] = useState<EthMove[]>([]);
  const [stages, setStages] = useState<Record<string, WithdrawalStage | 'error'>>({});
  const [inclusions, setInclusions] = useState<Record<string, EthInclusion | 'error'>>({});
  const [hemiWei, setHemiWei] = useState<bigint | null>(null);
  const [l1Wei, setL1Wei] = useState<bigint | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    const run = () => {
      void (async () => {
        const [rows, hemi, l1] = await Promise.all([
          readEthMoves(address),
          fetchHemiBalance(address).catch(() => null),
          readL1Eth(address).catch(() => null),
        ]);
        if (!live) return;
        const next = rows.map((row) => ({ ...row }));
        if (hemi != null) {
          for (const row of next) {
            if (row.direction !== 'to-hemi' || row.status === 'credited' || !row.hemiWeiBefore) continue;
            if (hemi >= BigInt(row.hemiWeiBefore) + BigInt(row.amountWei)) {
              row.status = 'credited';
              await markEthMove(row.id, 'credited');
            }
          }
        }
        setMoves(next);
        setHemiWei(hemi);
        setL1Wei(l1);
        const pending = next.filter((row) => row.direction === 'to-ethereum' && row.withdrawal && row.l2Block != null && row.status !== 'finalized');
        const deposits = next.filter((row) => row.direction === 'to-hemi' && row.status === 'submitted');
        const stageRows = await Promise.all(pending.map(async (row) => {
          const fields = withdrawalFields(row);
          if (!fields || row.l2Block == null) return [row.id, 'error'] as const;
          try {
            return [row.id, await readWithdrawalStage(fields, row.l2Block)] as const;
          } catch {
            return [row.id, 'error'] as const;
          }
        }));
        if (!live) return;
        const nextStages: Record<string, WithdrawalStage | 'error'> = {};
        for (const [id, stage] of stageRows) nextStages[id] = stage;
        setStages(nextStages);
        for (const [id, stage] of stageRows) {
          if (stage === 'error') continue;
          const move = next.find((row) => row.id === id);
          if (!move) continue;
          if (stage.kind === 'finalized' && move.status !== 'finalized') await markEthMove(id, 'finalized');
          if ((stage.kind === 'waiting-finality' || stage.kind === 'ready-to-finalize') && move.status === 'submitted') {
            await markEthMove(id, 'proven');
          }
        }
        const inclusionRows = await Promise.all(deposits.map(async (row) => {
          try {
            return [row.id, await readEthInclusion(row.txHash)] as const;
          } catch {
            return [row.id, 'error'] as const;
          }
        }));
        if (!live) return;
        setInclusions(Object.fromEntries(inclusionRows));
      })().catch(() => undefined);
    };
    run();
    const poll = setInterval(run, 20_000);
    return () => {
      live = false;
      clearInterval(poll);
    };
  }, [visible, address, tick]);

  const tracking = moves.some((move) => ethOpen(move, stages[move.id]));
  useEffect(() => {
    if (!visible || !tracking) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [visible, tracking]);

  const shown = moves.filter((move) => ethOpen(move, stages[move.id]));
  if (shown.length === 0) return null;

  const act = (id: string, task: Promise<string>, done: string) => {
    setBusy(id);
    setError(null);
    const toastId = toast.loading('Tunnel', 'Submitting the next transaction…');
    void task
      .then((hash) => {
        toast.update(toastId, 'success', done, hash ? `${String(hash).slice(0, 18)}…` : 'The tunnel recorded this step.', 7000);
      })
      .catch((err: unknown) => {
        const message = explainChainError(err);
        setError(message);
        toast.update(toastId, 'error', 'Tunnel failed', message, 8000);
      })
      .finally(() => setBusy(null));
  };

  return (
    <View style={styles.moves}>
      <Text style={styles.kicker}>ETH tunnel</Text>
      {shown.map((move) => {
        const toHemi = move.direction === 'to-hemi';
        const stage = stages[move.id];
        const view = toHemi ? depositView(move, inclusions[move.id], now) : withdrawView(move, stage, now);
        const fields = withdrawalFields(move);
        const proveOutput = stage != null && stage !== 'error' && stage.kind === 'ready-to-prove' ? stage.output : null;
        const canProve = !view.done && proveOutput != null;
        const canFinalize = !view.done && stage != null && stage !== 'error' && stage.kind === 'ready-to-finalize';
        const noGas = !toHemi && l1Wei === 0n;
        return (
          <View key={move.id} style={styles.card}>
            <Text style={styles.cardTitle}>{toHemi ? 'ETH → Hemi' : 'Hemi → ETH'}</Text>
            <Text style={styles.fine}>{formatWhen(move.createdAt)} · {formatHemi(BigInt(move.amountWei))} ETH</Text>
            <View style={styles.stepRow}>
              <SpinCoin spinning={view.spinning || busy === move.id} />
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>{busy === move.id ? 'Submitting the next transaction' : view.step}</Text>
                <Text style={styles.fine}>{view.message}</Text>
                <Text style={styles.eta}>{view.eta}</Text>
              </View>
            </View>
            {noGas && !view.done ? <Text style={styles.fine}>Proving and finalizing need ETH on Ethereum for gas.</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => { void Linking.openURL(toHemi ? ethTxUrl(move.txHash) : hemiTxUrl(move.txHash)); }}>
                <Text style={styles.actionLink}>Transaction</Text>
              </TouchableOpacity>
              {canProve && fields && proveOutput ? (
                <TouchableOpacity
                  style={[styles.primary, (busy != null || noGas) && styles.disabled]}
                  disabled={busy != null || noGas}
                  onPress={() => act(move.id, proveWithdrawal(fields, proveOutput).then(async (hash) => {
                    await markEthMove(move.id, 'proven');
                    return hash;
                  }), 'Proof submitted')}
                >
                  <Text style={styles.primaryText}>{busy === move.id ? 'Proving…' : 'Prove on Ethereum'}</Text>
                </TouchableOpacity>
              ) : null}
              {canFinalize && fields ? (
                <TouchableOpacity
                  style={[styles.primary, (busy != null || noGas) && styles.disabled]}
                  disabled={busy != null || noGas}
                  onPress={() => act(move.id, finalizeWithdrawal(fields).then(async (hash) => {
                    await markEthMove(move.id, 'finalized');
                    return hash;
                  }), 'Withdrawal finalized')}
                >
                  <Text style={styles.primaryText}>{busy === move.id ? 'Finalizing…' : 'Finalize on Ethereum'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
    </View>
  );
}

export function EthTunnelForm({
  address,
  ledger,
  onSent,
}: {
  address: string;
  ledger?: boolean;
  onSent: () => void;
}) {
  const [direction, setDirection] = useState<'to-hemi' | 'to-ethereum'>('to-hemi');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState(address);
  const [fee, setFee] = useState<bigint | null>(null);
  const [bridge, setBridge] = useState<EthBridgeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState(false);
  const [l1Wei, setL1Wei] = useState<bigint | null>(null);
  const [hemiWei, setHemiWei] = useState<bigint | null>(null);
  const [contractDest, setContractDest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const busy = flow.busy;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const toHemi = direction === 'to-hemi';
  const wei = readWei(amount);
  const balance = toHemi ? l1Wei : hemiWei;
  const paused = bridge != null && (bridge.portalPaused || (toHemi ? bridge.l1Paused : bridge.l2Paused));
  const invalid = amount.trim() !== '' && wei == null;
  const shortFee = wei != null && fee != null && balance != null && wei + fee > balance;
  const overBalance = wei != null && balance != null && wei > balance;
  const blocked = wei == null || wei <= 0n || invalid || paused || shortFee || overBalance;

  useEffect(() => {
    setDest(address);
    setFee(null);
    setTxUrl(null);
    setConfirmOpen(false);
    setError(null);
  }, [toHemi, address]);

  useEffect(() => {
    let live = true;
    void Promise.all([
      readEthBridge().then((info) => {
        if (!live) return;
        setBridge(info);
        setBridgeError(false);
      }).catch(() => {
        if (!live) return;
        setBridge(null);
        setBridgeError(true);
      }),
      readL1Eth(address).then((value) => { if (live) setL1Wei(value); }).catch(() => { if (live) setL1Wei(null); }),
      fetchHemiBalance(address).then((value) => { if (live) setHemiWei(value); }).catch(() => { if (live) setHemiWei(null); }),
    ]);
    return () => { live = false; };
  }, [address]);

  useEffect(() => {
    if (wei == null || wei <= 0n) {
      setFee(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void estimateBridgeFee(toHemi ? 'deposit' : 'withdraw', address, dest, wei)
        .then((next) => { if (live) setFee(next); })
        .catch(() => { if (live) setFee(null); });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [wei, toHemi, dest, address]);

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(dest.trim())) {
      setContractDest(false);
      return;
    }
    let live = true;
    void destinationIsContract(toHemi ? 'deposit' : 'withdraw', dest)
      .then((isContract) => { if (live) setContractDest(isContract); })
      .catch(() => { if (live) setContractDest(false); });
    return () => { live = false; };
  }, [dest, toHemi]);

  const fillMax = () => {
    if (balance == null) return;
    void maxBridgeAmount(toHemi ? 'deposit' : 'withdraw', address, dest, balance)
      .then((max) => setAmount(formatHemi(max)))
      .catch((err: unknown) => setError(explainChainError(err)));
  };

  const submit = async () => {
    if (wei == null) return;
    flow.begin(toHemi ? 'Broadcasting the Ethereum deposit…' : 'Sending the withdrawal on Hemi…');
    setError(null);
    try {
      if (toHemi) {
        const hash = await depositEth(address, dest, wei);
        await saveEthMove({
          id: hash,
          direction: 'to-hemi',
          createdAt: Date.now(),
          amountWei: wei.toString(),
          from: address,
          to: requireEthAddress(dest),
          txHash: hash,
          hemiWeiBefore: hemiWei == null ? undefined : hemiWei.toString(),
          status: 'submitted',
        });
        setTxUrl(ethTxUrl(hash));
        flow.finish(true, 'Deposit submitted', 'Hemi credits that address after the next derived blocks.');
      } else {
        const sent = await withdrawEth(address, dest, wei);
        await saveEthMove({
          id: sent.hash,
          direction: 'to-ethereum',
          createdAt: Date.now(),
          amountWei: wei.toString(),
          from: address,
          to: requireEthAddress(dest),
          txHash: sent.hash,
          l2Block: sent.l2Block,
          withdrawal: storedWithdrawal(sent.withdrawal, sent.withdrawalHash),
          status: 'submitted',
        });
        setTxUrl(hemiTxUrl(sent.hash));
        flow.finish(true, 'Withdrawal submitted', 'Prove it on Ethereum once an output includes this block.');
      }
      onSent();
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      flow.finish(false, 'Tunnel failed', message);
    }
  };

  const sendLabel = wei == null ? '—' : `${formatHemi(wei)} ETH`;
  const feeLabel = fee == null ? '—' : `${formatHemi(fee)} ETH`;

  return (
    <View>
      <View style={styles.hero}>
        <View style={styles.accent} />
        <View style={styles.kickerRow}>
          <Text style={styles.kicker}>Ethereum tunnel</Text>
          <Text style={styles.kicker}>{bridge ? (paused ? 'paused' : 'open') : '…'}</Text>
        </View>
        <Text style={styles.direction}>{toHemi ? 'Ethereum → Hemi' : 'Hemi → Ethereum'}</Text>
        <Text style={styles.meta}>
          {bridge
            ? `No protocol fee · 1 ETH in, 1 ETH out · withdrawal wait ${waitLabel(bridge.finalizationSeconds)} after the proof`
            : bridgeError
              ? 'Could not read the Ethereum bridge.'
              : 'Reading the Hemi Ethereum bridge…'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.kicker}>Available</Text>
        <AvailRow icon="ETH" ticker="ETH" detail="On Ethereum" amount={l1Wei == null ? '—' : formatHemi(l1Wei)} />
        <AvailRow icon="HEMIETH" ticker="ETH" detail="On Hemi" amount={hemiWei == null ? '—' : formatHemi(hemiWei)} bordered />
      </View>

      <View style={styles.choice}>
        <TouchableOpacity style={[styles.choiceBtn, toHemi && styles.choiceOn]} onPress={() => setDirection('to-hemi')}>
          <Text style={[styles.choiceText, toHemi && styles.choiceTextOn]}>Deposit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.choiceBtn, !toHemi && styles.choiceOn]} onPress={() => setDirection('to-ethereum')}>
          <Text style={[styles.choiceText, !toHemi && styles.choiceTextOn]}>Withdraw</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.labelRow}>
        <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
          Amount · {balance == null ? '…' : `${formatHemi(balance)} available`}
        </Text>
        <TouchableOpacity onPress={fillMax} disabled={balance == null || balance <= 0n}>
          <Text style={styles.actionLink}>Max</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={defiStyles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.01"
        placeholderTextColor="#71717a"
      />
      <Text style={styles.fieldLabel}>
        {toHemi ? 'Hemi address that receives ETH' : 'Ethereum address that receives ETH'}
      </Text>
      <TextInput
        style={defiStyles.input}
        value={dest}
        onChangeText={setDest}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#71717a"
      />

      <View style={styles.card}>
        <QuoteLine label="You send" value={sendLabel} />
        <QuoteLine label="Bridge fee" value="0 ETH" />
        <QuoteLine label={toHemi ? 'Ethereum network fee' : 'Hemi network fee'} value={feeLabel} />
        <QuoteLine label="You receive" value={sendLabel} />
      </View>

      {invalid ? <Text style={styles.fine}>Enter an ETH amount with at most 18 decimals.</Text> : null}
      {paused ? <Text style={styles.fine}>This direction of the bridge is paused.</Text> : null}
      {shortFee ? <Text style={styles.fine}>Leave some ETH for the network fee. The bridged amount is on top of gas.</Text> : null}
      {overBalance && !shortFee ? <Text style={styles.fine}>That is more than the available balance.</Text> : null}
      {contractDest ? (
        <Text style={styles.fine}>That address is a contract. If it rejects plain ETH, the tunnel can finish without paying it.</Text>
      ) : null}
      {ledger ? (
        <Text style={styles.fine}>
          Deposit, prove, and finalize sign on the Nano Ethereum app. Blind signing has to be on. Withdrawal signs on Hemi.
        </Text>
      ) : null}
      {busy ? (
        <View style={[styles.card, styles.stepCard]}>
          <View style={styles.stepRow}>
            <SpinCoin spinning />
            <View style={styles.stepCopy}>
              <Text style={styles.stepTitle}>Submitting</Text>
              <Text style={styles.fine}>
                {toHemi ? 'Broadcasting the Ethereum deposit.' : 'Sending the withdrawal on Hemi.'}
              </Text>
              <Text style={styles.eta}>A few seconds, then the tracker keeps this move.</Text>
            </View>
          </View>
        </View>
      ) : null}
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
      {txUrl ? (
        <TouchableOpacity onPress={() => { void Linking.openURL(txUrl); }}>
          <Text style={styles.link}>Open the transaction</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.primary, styles.wide, (blocked || busy) && styles.disabled]}
        onPress={() => {
          if (blocked) return;
          try {
            requireEthAddress(dest);
            setConfirmOpen(true);
          } catch (err: unknown) {
            setError(explainChainError(err));
          }
        }}
        disabled={blocked || busy}
      >
        <Text style={styles.primaryText}>{busy ? 'Submitting…' : toHemi ? 'Deposit ETH' : 'Withdraw ETH'}</Text>
      </TouchableOpacity>
      <Text style={styles.foot}>
        {toHemi
          ? 'A deposit calls the Hemi standard bridge on Ethereum. The same amount of ETH shows up on Hemi after the deposit is derived, usually within a few minutes. Ethereum gas is extra, and it is not taken out of the amount you bridge. An open move stays at the top of this page until it finishes.'
          : 'A withdrawal calls the Hemi standard bridge. When a Hemi output includes that block, prove the withdrawal on Ethereum, wait out the period above, then finalize. Prove and finalize each spend a little Ethereum gas. The ETH arrives on Ethereum when the finalize transaction succeeds. An open move stays at the top of this page until it finishes.'}
      </Text>
      <SpendConfirm
        open={confirmOpen}
        title={toHemi ? 'Deposit ETH' : 'Withdraw ETH'}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        confirmLabel={toHemi ? 'Deposit ETH' : 'Withdraw ETH'}
        rows={[
          { label: 'Direction', value: toHemi ? 'Ethereum → Hemi' : 'Hemi → Ethereum' },
          { label: 'You send', value: sendLabel },
          { label: 'Bridge fee', value: '0 ETH' },
          { label: toHemi ? 'Ethereum network fee' : 'Hemi network fee', value: feeLabel },
          { label: 'You receive', value: sendLabel },
          { label: 'To', value: dest.trim() },
        ]}
        onCancel={() => {
          flow.close(() => setAmount(''));
          setConfirmOpen(false);
        }}
        onConfirm={() => { void submit(); }}
      />
    </View>
  );
}
