import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import DefiModalShell from './DefiModalShell';
import SpendConfirm from '../SpendConfirm';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';
import TokenIcon from '../TokenIcon';
import { toast } from '../../utils/toast';
import { formatRawAmountFloor, rawToDecimal } from '../../utils/ethHoldings';
import FormattedNumber from '../FormattedNumber';
import {
  explainEthError,
  maxSendableEth,
  parseTokenAmount,
  readRawHoldings,
  sendEthAsset,
  type EthSendAsset,
} from '../../utils/ethChain';

interface Props {
  visible: boolean;
  address: string;
  onClose: () => void;
  onSent: (blockNumber?: number) => void;
}

const EthSendModal: React.FC<Props> = ({ visible, address, onClose, onSent }) => {
  const [asset, setAsset] = useState<EthSendAsset>('ETH');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [held, setHeld] = useState<{ eth: bigint; usdt: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setHash(null);
    setConfirmOpen(false);
    let cancel = false;
    void readRawHoldings(address)
      .then((next) => { if (!cancel) setHeld(next); })
      .catch((err: unknown) => { if (!cancel) setError(explainEthError(err)); });
    return () => { cancel = true; };
  }, [visible, address]);

  const balanceValue = held == null
    ? null
    : rawToDecimal(asset === 'ETH' ? held.eth : held.usdt, asset === 'ETH' ? 18 : 6);

  const fillMax = async () => {
    setError(null);
    try {
      if (asset === 'USDT') {
        const next = held ?? await readRawHoldings(address);
        if (next.usdt <= 0n) throw new Error('This wallet has no USDT.');
        setAmount(formatRawAmountFloor(next.usdt, 6, 6));
        return;
      }
      const max = await maxSendableEth(address);
      if (max <= 0n) throw new Error('Not enough ETH to pay for gas.');
      setAmount(formatRawAmountFloor(max, 18, 6));
    } catch (err: unknown) {
      setError(explainEthError(err));
    }
  };

  const openConfirm = () => {
    setError(null);
    try {
      parseTokenAmount(amount, asset === 'ETH' ? 18 : 6);
      if (!recipient.trim()) throw new Error('Enter the recipient address.');
    } catch (err: unknown) {
      setError(explainEthError(err));
      return;
    }
    setConfirmOpen(true);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const tx = await sendEthAsset(asset, recipient, amount);
      setHash(tx.hash);
      setConfirmOpen(false);
      setAmount('');
      toast.success('Sent', `${asset} is confirmed on Ethereum.`);
      onSent(tx.blockNumber);
      void readRawHoldings(address).then(setHeld).catch(() => undefined);
    } catch (err: unknown) {
      setConfirmOpen(false);
      setError(explainEthError(err));
      onSent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title={`Send ${asset}`}
      subtitle="Ethereum mainnet. Gas is paid in ETH."
    >
      <View style={defiStyles.ethChoiceRow}>
        {(['ETH', 'USDT'] as const).map((choice) => (
          <TouchableOpacity
            key={choice}
            style={[defiStyles.compactBtn, asset === choice && defiStyles.compactBtnActive, { flex: 1 }]}
            onPress={() => { setAsset(choice); setAmount(''); setError(null); }}
          >
            <View style={defiStyles.ethSymbolGroup}>
              <TokenIcon symbol={choice} size={18} />
              <Text style={[defiStyles.compactBtnText, asset === choice && defiStyles.compactBtnTextActive]}>
                {choice}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={defiStyles.label}>Available</Text>
      <View style={defiStyles.ethSymbolGroup}>
        <TokenIcon symbol={asset} size={22} />
        {balanceValue == null ? (
          <Text style={defiStyles.ethHoldingAmount}>…</Text>
        ) : (
          <FormattedNumber value={balanceValue} variant="balance" style={defiStyles.ethHoldingAmount} />
        )}
        <Text style={defiStyles.ethHoldingSymbol}>{asset}</Text>
      </View>
      <Text style={[defiStyles.label, { marginTop: 12 }]}>Recipient</Text>
      <TextInput
        style={defiStyles.input}
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="0x…"
        placeholderTextColor="#71717a"
      />
      <Text style={defiStyles.label}>Amount</Text>
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
          <Text style={defiStyles.compactBtnTextActive}>Max</Text>
        </TouchableOpacity>
      </View>
      {asset === 'ETH' ? (
        <Text style={defiStyles.ethHoldingsHint}>Max leaves enough ETH behind to pay the gas.</Text>
      ) : null}
      {error ? <Text style={defiStyles.ethError}>{error}</Text> : null}
      {hash ? (
        <TouchableOpacity onPress={() => { void Linking.openURL(`https://etherscan.io/tx/${hash}`); }}>
          <Text style={defiStyles.ethTxLink}>View {hash.slice(0, 10)}… on Etherscan</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[defiStyles.heroSendBtn, { marginTop: 14, alignItems: 'center' }]}
        onPress={openConfirm}
        disabled={busy}
      >
        {busy ? <ActivityIndicator size="small" color={theme.colors.primary} /> : (
          <Text style={defiStyles.heroSendBtnText}>Review send</Text>
        )}
      </TouchableOpacity>
      {hash ? (
        <TouchableOpacity onPress={() => { void Clipboard.setStringAsync(hash); toast.success('Copied', 'Transaction hash'); }}>
          <Text style={defiStyles.modalClose}>Copy transaction hash</Text>
        </TouchableOpacity>
      ) : null}
      <SpendConfirm
        open={confirmOpen}
        title={`Send ${asset}`}
        busy={busy}
        confirmLabel={`Send ${asset}`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { void send(); }}
        rows={[
          { label: 'Amount', value: `${amount.trim()} ${asset}` },
          { label: 'To', value: recipient.trim() },
          { label: 'From', value: address },
          { label: 'Network', value: 'Ethereum mainnet' },
        ]}
      />
    </DefiModalShell>
  );
};

export default EthSendModal;
