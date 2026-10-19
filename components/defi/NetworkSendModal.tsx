import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import DefiModalShell from './DefiModalShell';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import { defiStyles } from './defiStyles';
import { formatRawAmountFloor } from '../../utils/ethHoldings';
import { explainChainError } from '../../utils/networks/http';
import {
  btcTxUrl,
  fetchBtcBalance,
  formatBtc,
  maxSendableBtc,
  parseBtc,
  quoteBtcFee,
  sendBtc,
} from '../../utils/networks/btc';
import {
  fetchHemiBalance,
  formatHemi,
  hemiTxUrl,
  maxSendableHemi,
  parseHemi,
  quoteHemiFee,
  sendHemi,
} from '../../utils/networks/hemi';
import {
  SOL_FEE_LAMPORTS,
} from '../../utils/networks/chains';
import {
  fetchSolBalance,
  formatSol,
  maxSendableSol,
  parseSol,
  sendSol,
  solTxUrl,
} from '../../utils/networks/solana';
import { toast } from '../../utils/toast';

export type NetworkKind = 'btc' | 'hemi' | 'sol';

const COPY: Record<NetworkKind, { title: string; unit: string; subtitle: string; placeholder: string }> = {
  btc: {
    title: 'Send Bitcoin',
    unit: 'BTC',
    subtitle: 'Bitcoin mainnet. Native segwit from this account.',
    placeholder: 'bc1…',
  },
  hemi: {
    title: 'Send on Hemi',
    unit: 'ETH',
    subtitle: 'Hemi network. Gas is ETH on Hemi. The address matches Ethereum.',
    placeholder: '0x…',
  },
  sol: {
    title: 'Send SOL',
    unit: 'SOL',
    subtitle: 'Solana mainnet. Same account path Backpack and Phantom use.',
    placeholder: 'Solana address',
  },
};

interface Props {
  visible: boolean;
  kind: NetworkKind | null;
  address: string;
  onClose: () => void;
  onSent: () => void;
}

const NetworkSendModal: React.FC<Props> = ({ visible, kind, address, onClose, onSent }) => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [held, setHeld] = useState<string | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  const meta = kind ? COPY[kind] : COPY.btc;

  useEffect(() => {
    if (!visible || !kind) return;
    setRecipient('');
    setAmount('');
    setHeld(null);
    setFee(null);
    setError(null);
    setTxUrl(null);
    setConfirmOpen(false);
    let cancel = false;
    const load = kind === 'btc'
      ? fetchBtcBalance(address).then(formatBtc)
      : kind === 'hemi'
        ? fetchHemiBalance(address).then(formatHemi)
        : fetchSolBalance(address).then(formatSol);
    void load
      .then((next) => { if (!cancel) setHeld(next); })
      .catch((err: unknown) => { if (!cancel) setError(explainChainError(err)); });
    return () => { cancel = true; };
  }, [visible, kind, address]);

  const fillMax = async () => {
    if (!kind) return;
    setError(null);
    try {
      if (kind === 'btc') {
        const max = await maxSendableBtc(address);
        if (max <= 0n) throw new Error('Not enough Bitcoin to pay the miner fee.');
        setAmount(formatBtc(max));
        return;
      }
      if (kind === 'hemi') {
        const max = await maxSendableHemi(address);
        if (max <= 0n) throw new Error('Not enough ETH on Hemi to pay for gas.');
        setAmount(formatRawAmountFloor(max, 18, 6));
        return;
      }
      const balance = await fetchSolBalance(address);
      const max = maxSendableSol(balance);
      if (max <= 0n) throw new Error('Not enough SOL to pay the network fee.');
      setAmount(formatSol(max));
    } catch (err: unknown) {
      setError(explainChainError(err));
    }
  };

  const openConfirm = async () => {
    if (!kind) return;
    setError(null);
    setFee(null);
    try {
      if (!recipient.trim()) throw new Error('Enter the recipient address.');
      if (kind === 'btc') parseBtc(amount);
      else if (kind === 'hemi') parseHemi(amount);
      else parseSol(amount);
      const nextFee = kind === 'btc'
        ? `${formatBtc(await quoteBtcFee(recipient, amount))} BTC`
        : kind === 'hemi'
          ? `up to ${formatHemi(await quoteHemiFee())} ETH`
          : `${formatSol(SOL_FEE_LAMPORTS)} SOL`;
      setFee(nextFee);
      setConfirmOpen(true);
    } catch (err: unknown) {
      setConfirmOpen(false);
      setError(explainChainError(err));
    }
  };

  const send = async () => {
    if (!kind) return;
    const network = kind === 'btc' ? 'Bitcoin' : kind === 'hemi' ? 'Hemi' : 'Solana';
    flow.begin(`Sending ${amount.trim()} ${meta.unit} on ${network}…`);
    setError(null);
    try {
      if (kind === 'btc') {
        const tx = await sendBtc(recipient, amount);
        setTxUrl(btcTxUrl(tx.txid));
        flow.finish(true, 'Sent', `Bitcoin accepted ${amount.trim()} BTC.`);
      } else if (kind === 'hemi') {
        const tx = await sendHemi(recipient, amount);
        setTxUrl(hemiTxUrl(tx.hash));
        flow.finish(true, 'Sent', `Hemi confirmed ${amount.trim()} ETH.`);
      } else {
        const tx = await sendSol(recipient, amount);
        setTxUrl(solTxUrl(tx.signature));
        flow.finish(true, 'Sent', `Solana accepted ${amount.trim()} SOL.`);
      }
      onSent();
    } catch (err: unknown) {
      const message = explainChainError(err);
      setError(message);
      flow.finish(false, 'Send failed', message);
    }
  };

  return (
    <DefiModalShell visible={visible && kind != null} onClose={onClose} title={meta.title} subtitle={meta.subtitle}>
      <Text style={defiStyles.label}>To</Text>
      <TextInput
        style={defiStyles.input}
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={meta.placeholder}
        placeholderTextColor="#71717a"
      />
      <Text style={defiStyles.label}>Amount{held == null ? '' : ` · ${held} ${meta.unit}`}</Text>
      <View style={defiStyles.ethAmountRow}>
        <TextInput
          style={[defiStyles.input, { flex: 1, marginBottom: 0 }]}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#71717a"
        />
        <TouchableOpacity style={defiStyles.ethMaxBtn} onPress={() => { void fillMax(); }}>
          <Text style={defiStyles.heroSendBtnText}>Max</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
      {txUrl ? (
        <TouchableOpacity onPress={() => { void Linking.openURL(txUrl); }}>
          <Text style={defiStyles.ethTxLink}>View transaction</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[defiStyles.heroSendBtn, { marginTop: 12 }]}
        onPress={() => { void openConfirm(); }}
        disabled={flow.busy}
      >
        <Text style={defiStyles.heroSendBtnText}>Review</Text>
      </TouchableOpacity>
      <SpendConfirm
        open={confirmOpen}
        title={meta.title}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        confirmLabel={`Send ${meta.unit}`}
        rows={[
          { label: 'Network', value: meta.subtitle.split('.')[0] },
          { label: 'To', value: recipient.trim() },
          { label: 'Amount', value: `${amount.trim()} ${meta.unit}` },
          { label: 'Fee', value: fee ?? 'Calculating…' },
        ]}
        onCancel={() => {
          flow.close(() => setAmount(''));
          setConfirmOpen(false);
        }}
        onConfirm={() => { void send(); }}
      />
    </DefiModalShell>
  );
};

export default NetworkSendModal;
