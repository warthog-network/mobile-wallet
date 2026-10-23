import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ethers } from 'ethers';
import DefiModalShell from './DefiModalShell';
import SpendConfirm, { useSpendFlow } from '../SpendConfirm';
import AssetMenu from './AssetMenu';
import { useWalletTokens } from './useWalletTokens';
import { defiStyles } from './defiStyles';
import { theme } from '../../theme';
import TokenIcon, { tokenMark } from '../TokenIcon';
import { toast } from '../../utils/toast';
import { formatRawAmountFloor } from '../../utils/ethHoldings';
import FormattedNumber from '../FormattedNumber';
import {
  explainEthError,
  maxSendableEth,
  parseTokenAmount,
  sendEthAsset,
  sendEthCall,
} from '../../utils/ethChain';
import { readHoldingAmounts, readOneBalance } from '../../utils/tokenBalances';
import { isLedgerSession } from '../../utils/sessionVault';

const ERC20 = new ethers.Interface(['function transfer(address to, uint256 amount)']);

interface Props {
  visible: boolean;
  address: string;
  onClose: () => void;
  onSent: (blockNumber?: number) => void;
}

const EthSendModal: React.FC<Props> = ({ visible, address, onClose, onSent }) => {
  const { tokens } = useWalletTokens('ethereum');
  const [assetId, setAssetId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const flow = useSpendFlow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const token = tokens.find((item) => item.id === assetId) ?? tokens[0];

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setHash(null);
    setConfirmOpen(false);
    let cancel = false;
    void readHoldingAmounts(address, tokens)
      .then((rows) => {
        if (cancel) return;
        const next: Record<string, string> = {};
        Object.entries(rows).forEach(([id, text]) => { if (text != null) next[id] = text; });
        setBalances(next);
      })
      .catch((err: unknown) => { if (!cancel) setError(explainEthError(err)); });
    return () => { cancel = true; };
  }, [visible, address, tokens]);

  const balanceValue = token ? balances[token.id] ?? null : null;

  const fillMax = async () => {
    if (!token) return;
    setError(null);
    try {
      if (!token.native) {
        const raw = await readOneBalance('ethereum', address, token);
        if (raw <= 0n) throw new Error(`This wallet has no ${token.symbol}.`);
        setAmount(formatRawAmountFloor(raw, token.decimals, Math.min(token.decimals, 8)));
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
    if (!token) return;
    setError(null);
    try {
      parseTokenAmount(amount, token.decimals);
      if (!ethers.isAddress(recipient.trim())) throw new Error('Enter a valid Ethereum address.');
      if (ethers.getAddress(recipient.trim()).toLowerCase() === address.toLowerCase()) {
        throw new Error('That address is this wallet.');
      }
    } catch (err: unknown) {
      setError(explainEthError(err));
      return;
    }
    setConfirmOpen(true);
  };

  const send = async () => {
    if (!token) return;
    flow.begin(isLedgerSession()
      ? 'Approve this on the Nano. Leave the Ethereum app open.'
      : `Sending ${amount.trim()} ${token.symbol}…`);
    setError(null);
    try {
      if (token.native) {
        const tx = await sendEthAsset('ETH', recipient, amount);
        setHash(tx.hash);
        flow.finish(true, 'Sent', `${amount.trim()} ETH is confirmed on Ethereum.`);
        onSent(tx.blockNumber);
      } else {
        const raw = parseTokenAmount(amount, token.decimals);
        const owned = await readOneBalance('ethereum', address, token);
        if (raw > owned) {
          throw new Error(`Only ${formatRawAmountFloor(owned, token.decimals, Math.min(token.decimals, 8))} ${token.symbol} is in this wallet.`);
        }
        const to = ethers.getAddress(recipient.trim());
        const data = ERC20.encodeFunctionData('transfer', [to, raw]);
        const receipt = await sendEthCall({ to: token.address, data });
        setHash(receipt.hash);
        flow.finish(true, 'Sent', `${amount.trim()} ${token.symbol} is confirmed on Ethereum.`);
        onSent(Number(receipt.blockNumber));
      }
      void readHoldingAmounts(address, tokens).then((rows) => {
        const next: Record<string, string> = {};
        Object.entries(rows).forEach(([id, text]) => { if (text != null) next[id] = text; });
        setBalances(next);
      }).catch(() => undefined);
    } catch (err: unknown) {
      const message = explainEthError(err);
      setError(message);
      flow.finish(false, 'Send failed', message);
      onSent();
    }
  };

  return (
    <DefiModalShell
      visible={visible}
      onClose={onClose}
      title={`Send ${token?.symbol ?? 'ETH'}`}
      subtitle="Ethereum mainnet. Gas is paid in ETH."
    >
      {token ? (
        <AssetMenu
          label={token.symbol}
          tokens={tokens}
          selectedId={token.id}
          balances={balances}
          network="ethereum"
          icon={tokenMark(token.symbol, 'ethereum', token.native)}
          onSelect={(next) => { setAssetId(next.id); setAmount(''); setError(null); }}
        />
      ) : null}
      <Text style={defiStyles.label}>Available</Text>
      <View style={defiStyles.ethSymbolGroup}>
        <TokenIcon symbol={tokenMark(token?.symbol ?? 'ETH', 'ethereum', token?.native)} size={22} />
        {balanceValue == null ? (
          <Text style={defiStyles.ethHoldingAmount}>…</Text>
        ) : (
          <FormattedNumber value={balanceValue} variant="balance" style={defiStyles.ethHoldingAmount} />
        )}
        <Text style={defiStyles.ethHoldingSymbol}>{token?.symbol ?? 'ETH'}</Text>
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
      {token?.native ? (
        <Text style={defiStyles.ethHoldingsHint}>Max leaves enough ETH behind to pay the gas.</Text>
      ) : (
        <Text style={defiStyles.ethHoldingsHint}>The network fee is paid in ETH.</Text>
      )}
      {isLedgerSession() ? (
        <Text style={defiStyles.ethHoldingsHint}>
          {token?.native
            ? 'The Ethereum app on the Nano approves this. Leave that app open.'
            : 'The Ethereum app approves this send. Turn on Blind signing in that app, and leave it open.'}
        </Text>
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
        disabled={flow.busy}
      >
        {flow.busy ? <ActivityIndicator size="small" color={theme.colors.primary} /> : (
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
        title={`Send ${token?.symbol ?? 'ETH'}`}
        busy={flow.busy}
        step={flow.step}
        outcome={flow.outcome}
        confirmLabel={isLedgerSession() ? 'Approve on Ledger' : `Send ${token?.symbol ?? 'ETH'}`}
        onCancel={() => {
          flow.close(() => setAmount(''));
          setConfirmOpen(false);
        }}
        onConfirm={() => { void send(); }}
        rows={[
          { label: 'Amount', value: `${amount.trim()} ${token?.symbol ?? 'ETH'}` },
          { label: 'To', value: recipient.trim() },
          { label: 'From', value: address },
          { label: 'Network', value: 'Ethereum mainnet' },
        ]}
      />
    </DefiModalShell>
  );
};

export default EthSendModal;
